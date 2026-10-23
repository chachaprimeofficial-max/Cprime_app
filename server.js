require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || 'cprime_mall',
  user: process.env.DB_USER || 'cprime_app',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  charset: 'utf8mb4',
  decimalNumbers: true
});

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use(session({
  name: 'cp.sid',
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const HOSTS = {
  corporate: process.env.CORPORATE_HOST || 'corporate.chachaprime.com',
  mall: process.env.MALL_HOST || 'chachaprime.com',
  services: process.env.SERVICES_HOST || 'services.chachaprime.com',
  source: process.env.SOURCE_HOST || 'source.chachaprime.com',
  admin: process.env.ADMIN_HOST || 'admin.chachaprime.com'
};
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hostOf = req => String(req.hostname || '').toLowerCase().split(':')[0].replace(/^www\./, '');
function siteFor(req) {
  const host = hostOf(req);
  for (const [site, configured] of Object.entries(HOSTS)) if (host === configured.toLowerCase()) return site;
  if (host === 'localhost' || host === '127.0.0.1') return String(req.query.site || 'mall');
  return 'mall';
}
function page(title, body, user, site) {
  const nav = {
    corporate: [['Home','/'],['About','/#about'],['Companies','/#companies'],['Contact','/#contact']],
    mall: [['Shop','/'],['Group Buying','/#groups'],['B2B','/#b2b'],['My Account','/account']],
    services: [['Sourcing','/#sourcing'],['Shipping','/#shipping'],['Visa Inquiry','/#visa'],['Business Services','/#business']],
    source: [['Dashboard','/'],['Supplier Directory','/#suppliers'],['Add Supplier','/#add-supplier']],
    admin: [['Overview','/admin'],['Products','/admin/products'],['Orders','/admin/orders'],['Requests','/admin/requests'],['Suppliers','/admin/suppliers'],['Staff','/admin/staff']]
  }[site] || [];
  const navHtml = nav.map(([label,url]) => '<a href="' + url + '">' + esc(label) + '</a>').join('');
  const userHtml = user ? '<span class="muted">' + esc(user.name) + ' · ' + esc(user.role) + '</span><form method="post" action="/api/auth/logout"><button class="small secondary">Log out</button></form>' : '<a class="button small" href="/login">Sign in</a>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + ' | CHACHA PRIME</title><link rel="stylesheet" href="/app.css"></head><body><header class="top"><a class="brand" href="/"><span class="mark">C</span><span>CHACHA <b>PRIME</b><small>LIVE E-COMMERCE · SOURCING · TRADE</small></span></a><nav>' + navHtml + '</nav><div class="user">' + userHtml + '</div></header><main>' + body + '</main><footer><b>CHACHA PRIME</b><span>Yiwu Chacha International Trade Co., Ltd.</span><span>© 2026 ChachaPrime</span></footer><script>document.querySelectorAll("form[data-confirm]").forEach(f=>f.addEventListener("submit",e=>{if(!confirm("Continue with this action?"))e.preventDefault()}));</script></body></html>';
}
function requireAuth(req,res,next) { if (!req.session.user) return res.status(401).json({error:'Please sign in first.'}); next(); }
function requireRole(...roles) { return (req,res,next) => { if (!req.session.user) return res.status(401).json({error:'Please sign in first.'}); if (!roles.includes(req.session.user.role)) return res.status(403).json({error:'You do not have permission.'}); next(); }; }
async function logAction(req, action, entityType = null, entityId = null, metadata = null) {
  try { await pool.execute('INSERT INTO activity_logs (user_id,action,entity_type,entity_id,ip_address,metadata) VALUES (?,?,?,?,?,?)', [req.session.user?.id || null, action, entityType, entityId, req.ip, metadata ? JSON.stringify(metadata) : null]); } catch (_) {}
}
function shell(title, intro, content, user, site) {
  return page(title, '<section class="hero"><div><p class="eyebrow">CHACHA PRIME · GLOBAL TRADE</p><h1>' + title + '</h1><p class="lead">' + intro + '</p></div><div class="hero-art"><div class="gold-ring"></div><div class="hero-card"><span>CP</span><b>Built for global business</b><small>One platform · Connected teams</small></div></div></section>' + content, user, site);
}
function card(title, text, href, label = 'Explore') {
  return '<article class="card"><h3>' + title + '</h3><p>' + text + '</p>' + (href ? '<a class="text-link" href="' + href + '">' + label + ' →</a>' : '') + '</article>';
}
function formFields(type) {
  return '<form class="form card" method="post" action="/api/requests"><input type="hidden" name="request_type" value="' + type + '"><label>Full name<input name="name" required maxlength="160"></label><label>Email<input type="email" name="email" required maxlength="190"></label><label>Phone / WhatsApp<input name="phone" maxlength="40"></label><label>Company<input name="company" maxlength="190"></label><label>Country<input name="country" maxlength="100"></label><label>How can we help?<textarea name="details" required maxlength="5000" rows="5"></textarea></label><button type="submit">Submit inquiry</button></form>';
}

app.get('/health', async (_req,res) => {
  try { await pool.query('SELECT 1'); res.json({status:'ok',database:'connected'}); }
  catch (e) { res.status(503).json({status:'error',database:'unavailable'}); }
});
app.get('/app.css', (_req,res) => res.sendFile(require('path').join(__dirname,'public','app.css')));

app.get('/api/products', async (req,res) => {
  try {
    const [rows] = await pool.execute("SELECT id,sku,name_en,name_zh,description_en,category,image_url,base_price,retail_price,b2b_price,group_price,list_price,currency,stock_qty FROM products WHERE status='active' ORDER BY created_at DESC LIMIT 100");
    res.json({data:rows});
  } catch (e) { res.status(500).json({error:'Could not load products.'}); }
});
app.post('/api/auth/register', async (req,res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) return res.status(400).json({error:'Enter a name, valid email, and password of at least 12 characters.'});
  try {
    const hash = await bcrypt.hash(password, 12);
    const [r] = await pool.execute("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'customer')", [name,email,hash]);
    req.session.user = {id:r.insertId,name,email,role:'customer'};
    await logAction(req,'customer.register','user',r.insertId);
    res.redirect('/account');
  } catch (e) { res.status(e.code === 'ER_DUP_ENTRY' ? 409 : 500).send(e.code === 'ER_DUP_ENTRY' ? 'An account with this email already exists.' : 'Registration failed.'); }
});
app.post('/api/auth/login', async (req,res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  try {
    const [rows] = await pool.execute("SELECT id,name,email,password_hash,role,status FROM users WHERE email=? LIMIT 1",[email]);
    const u = rows[0];
    if (!u || u.status !== 'active' || !(await bcrypt.compare(password,u.password_hash))) return res.status(401).send('Email or password is incorrect.');
    req.session.regenerate(async err => {
      if (err) return res.status(500).send('Could not start session.');
      req.session.user = {id:u.id,name:u.name,email:u.email,role:u.role};
      await logAction(req,'auth.login','user',u.id);
      const site = siteFor(req);
      res.redirect(u.role === 'admin' ? '/admin' : u.role === 'sourcing' || u.role === 'staff' ? '/' : '/account');
    });
  } catch (e) { res.status(500).send('Sign in is temporarily unavailable.'); }
});
app.post('/api/auth/logout', (req,res) => req.session.destroy(() => res.redirect('/')));
app.post('/api/requests', async (req,res) => {
  const type = String(req.body.request_type || 'contact');
  const allowed = ['sourcing','shipping','visa','business','consultation','contact'];
  const name = String(req.body.name || '').trim(), email = String(req.body.email || '').trim(), details = String(req.body.details || '').trim();
  if (!allowed.includes(type) || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !details) return res.status(400).send('Please complete all required fields.');
  try {
    const [r] = await pool.execute('INSERT INTO service_requests (request_type,name,email,phone,company,country,details) VALUES (?,?,?,?,?,?,?)',[type,name,email,String(req.body.phone||'').slice(0,40),String(req.body.company||'').slice(0,190),String(req.body.country||'').slice(0,100),details.slice(0,5000)]);
    await logAction(req,'request.created','service_request',r.insertId,{request_type:type});
    res.status(201).send(page('Inquiry received','<section class="section"><div class="notice"><h2>Thank you — your inquiry has been received.</h2><p>Our team will review your request and contact you using the details provided.</p><a class="button" href="/">Return home</a></div></section>',req.session.user,siteFor(req)));
  } catch (e) { res.status(500).send('We could not save your inquiry. Please try again later.'); }
});

app.get('/admin', requireRole('admin'), async (req,res) => {
  try {
    const [[p]] = await pool.query('SELECT COUNT(*) AS total FROM products');
    const [[o]] = await pool.query('SELECT COUNT(*) AS total FROM orders');
    const [[r]] = await pool.query("SELECT COUNT(*) AS total FROM service_requests WHERE status='new'");
    const [[s]] = await pool.query("SELECT COUNT(*) AS total FROM suppliers WHERE verification_status='pending'");
    const [recent] = await pool.query('SELECT id,request_type,name,email,status,created_at FROM service_requests ORDER BY created_at DESC LIMIT 8');
    const rows = recent.map(x=>'<tr><td>'+esc(x.id)+'</td><td>'+esc(x.request_type)+'</td><td>'+esc(x.name)+'</td><td>'+esc(x.email)+'</td><td>'+esc(x.status)+'</td><td>'+new Date(x.created_at).toLocaleDateString()+'</td></tr>').join('');
    const body = '<section class="section"><p class="eyebrow">ADMIN CONTROL CENTER</p><h1>Operations overview</h1><div class="stats"><div class="stat"><small>Products</small><strong>'+p.total+'</strong></div><div class="stat"><small>Orders</small><strong>'+o.total+'</strong></div><div class="stat"><small>New requests</small><strong>'+r.total+'</strong></div><div class="stat"><small>Suppliers awaiting review</small><strong>'+s.total+'</strong></div></div><h2>Recent service requests</h2><div class="table-wrap"><table><thead><tr><th>ID</th><th>Type</th><th>Name</th><th>Email</th><th>Status</th><th>Date</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="muted">Detailed CRUD screens, staff permissions, reporting and CMS are part of the next implementation phase.</p></section>';
    res.send(page('Admin dashboard',body,req.session.user,'admin'));
  } catch (e) { res.status(500).send('Admin dashboard could not load. Check database migrations.'); }
});
app.post('/api/admin/products', requireRole('admin'), async (req,res) => {
  const sku=String(req.body.sku||'').trim(), name=String(req.body.name_en||'').trim();
  const num=v=>Number.isFinite(Number(v)) && Number(v)>=0 ? Number(v) : 0;
  if (!sku || !name) return res.status(400).json({error:'SKU and English product name are required.'});
  try {
    const [r]=await pool.execute('INSERT INTO products (sku,name_en,name_zh,description_en,description_zh,category,image_url,base_price,retail_price,b2b_price,group_price,list_price,stock_qty,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[sku,name,req.body.name_zh||null,req.body.description_en||null,req.body.description_zh||null,req.body.category||null,req.body.image_url||null,num(req.body.base_price),num(req.body.retail_price),num(req.body.b2b_price),req.body.group_price ? num(req.body.group_price):null,req.body.list_price ? num(req.body.list_price):null,Math.floor(num(req.body.stock_qty)),req.body.status==='active'?'active':'draft',req.session.user.id]);
    await logAction(req,'product.created','product',r.insertId);
    res.status(201).json({id:r.insertId});
  } catch(e) { res.status(e.code==='ER_DUP_ENTRY'?409:500).json({error:e.code==='ER_DUP_ENTRY'?'SKU already exists.':'Could not create product.'}); }
});
app.get('/api/admin/requests', requireRole('admin'), async (_req,res) => {
  try { const [rows]=await pool.query('SELECT id,request_type,name,email,phone,company,country,details,status,created_at FROM service_requests ORDER BY created_at DESC LIMIT 300'); res.json({data:rows}); }
  catch(e) { res.status(500).json({error:'Could not load requests.'}); }
});
app.post('/api/source/suppliers', requireRole('admin','sourcing','staff'), async (req,res) => {
  const company=String(req.body.company_name||'').trim();
  if(!company) return res.status(400).json({error:'Supplier company name is required.'});
  try {
    const [r]=await pool.execute('INSERT INTO suppliers (company_name,contact_name,email,phone,country,city,address,business_card_url,categories,moq,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[company,req.body.contact_name||null,req.body.email||null,req.body.phone||null,req.body.country||'China',req.body.city||null,req.body.address||null,req.body.business_card_url||null,JSON.stringify(req.body.categories||[]),req.body.moq||null,req.body.notes||null,req.session.user.id]);
    await logAction(req,'supplier.created','supplier',r.insertId);
    res.status(201).json({id:r.insertId,verification_status:'pending'});
  } catch(e) { res.status(500).json({error:'Could not save supplier.'}); }
});

app.get('*', async (req,res) => {
  const site = siteFor(req), user = req.session.user;
  const login = '<section class="section narrow"><h1>Sign in</h1><p class="muted">Use your approved ChachaPrime account.</p><form class="form card" method="post" action="/api/auth/login"><label>Email<input type="email" name="email" required autocomplete="username"></label><label>Password<input type="password" name="password" required autocomplete="current-password"></label><button type="submit">Sign in securely</button></form><p>New customer? <a href="/register">Create an account</a></p></section>';
  if(req.path==='/login') return res.send(page('Sign in',login,user,site));
  if(req.path==='/register') return res.send(page('Create account','<section class="section narrow"><h1>Create your account</h1><form class="form card" method="post" action="/api/auth/register"><label>Full name<input name="name" required maxlength="160"></label><label>Email<input type="email" name="email" required></label><label>Password (12+ characters)<input type="password" name="password" minlength="12" required autocomplete="new-password"></label><button type="submit">Create account</button></form></section>',user,site));
  if(req.path==='/account') {
    if(!user) return res.redirect('/login');
    const [orders] = await pool.execute('SELECT order_number,status,total,currency,created_at FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 20',[user.id]);
    const list=orders.length?'<div class="table-wrap"><table><tr><th>Order</th><th>Status</th><th>Total</th><th>Date</th></tr>'+orders.map(o=>'<tr><td>'+esc(o.order_number)+'</td><td>'+esc(o.status)+'</td><td>'+esc(o.currency)+' '+esc(o.total)+'</td><td>'+new Date(o.created_at).toLocaleDateString()+'</td></tr>').join('')+'</table></div>':'<p>No orders yet. Your orders will appear here.</p>';
    return res.send(page('My account','<section class="section"><h1>Hello, '+esc(user.name)+'</h1><h2>Your order history</h2>'+list+'</section>',user,site));
  }
  if(site==='corporate') {
    const content='<section class="section grid3">'+card('Our company','Yiwu Chacha International Trade Co., Ltd. connects sourcing, commerce and cross-border trade.','#about')+card('Our companies','A connected international business network supporting trade and operations.','#companies')+card('Consultation','Tell us about your project, market or sourcing needs.','#contact')+'</section><section id="about" class="section split"><div><p class="eyebrow">ABOUT CHACHA PRIME</p><h2>One connected platform for global business.</h2><p>Commerce, sourcing, logistics and business support connected through one operating system.</p></div><div class="panel"><h3>Our focus</h3><p>Reliable supplier discovery, practical trade support and transparent customer service.</p></div></section><section id="companies" class="section"><h2>Our companies</h2>'+card('Yiwu Chacha International Trade Co., Ltd.','Yiwu, Zhejiang, China',null)+card('Arain 7 LLC','Casper, Wyoming, USA',null)+card('Arain 7 (SMC-Private) Limited','Pakistan',null)+'</section><section id="contact" class="section split"><div><h2>Contact our team</h2><p>Share your business goals and we will route your inquiry to the relevant team.</p></div>'+formFields('consultation')+'</section>';
    return res.send(shell('Global trade, connected.','A premium home for commerce, sourcing and cross-border business.',content,user,site));
  }
  if(site==='services') {
    const content='<section class="section grid3">'+card('China sourcing','Product research, factory discovery, supplier verification and MOQ negotiation.','#sourcing')+card('Shipping & logistics','Sea, air, express, rail and DDP inquiry routing.','#shipping')+card('Visa inquiry','Business and travel inquiry intake for M, Z, X and F visa categories.','#visa')+'</section><section id="sourcing" class="section split"><div><h2>Start a sourcing request</h2><p>Tell us the product, target price, quantity and required timeline.</p></div>'+formFields('sourcing')+'</section><section id="shipping" class="section split"><div><h2>Shipping & logistics</h2><p>Describe cargo, origin, destination, volume and preferred shipping method.</p></div>'+formFields('shipping')+'</section><section id="visa" class="section split"><div><h2>Visa inquiry</h2><p>Submit an inquiry for the relevant visa category. Eligibility and decisions remain with the official authorities.</p></div>'+formFields('visa')+'</section><section id="business" class="section split"><div><h2>Business services</h2><p>Factory visits, inspection, OEM/ODM and import/export support.</p></div>'+formFields('business')+'</section>';
    return res.send(shell('Trade services, made simpler.','China sourcing, logistics coordination and business-service inquiries in one place.',content,user,site));
  }
  if(site==='source') {
    const content='<section class="section"><div class="notice"><h2>Internal supplier portal</h2><p>Supplier entries require an approved staff, sourcing or admin account. New records start as pending verification.</p></div><div class="split"><div><h2>Supplier directory</h2><p>Search, verification workflows, business-card uploads and factory galleries will connect to the shared supplier database.</p></div><div class="card"><h3>Access required</h3><p>Sign in with your staff account to continue.</p><a class="button" href="/login">Staff sign in</a></div></div></section>';
    return res.send(shell('Supplier & sourcing workspace','A controlled workspace for factory discovery, supplier records and team performance.',content,user,site));
  }
  if(site==='admin') {
    if(user?.role==='admin') return res.redirect('/admin');
    return res.send(page('Admin sign in','<section class="section narrow"><div class="notice"><h1>Admin access</h1><p>Sign in with an account whose role is admin. Public registration never grants admin permissions.</p></div>'+login+'</section>',user,site));
  }
  let products=[];
  try { [products]=await pool.execute("SELECT id,name_en,description_en,category,image_url,retail_price,b2b_price,group_price,currency FROM products WHERE status='active' ORDER BY created_at DESC LIMIT 12"); } catch(e) {}
  const productCards=products.length?'<div class="grid3">'+products.map(p=>'<article class="card product">'+(p.image_url?'<img src="'+esc(p.image_url)+'" alt="'+esc(p.name_en)+'">':'<div class="product-placeholder">CP</div>')+'<p class="eyebrow">'+esc(p.category||'Featured product')+'</p><h3>'+esc(p.name_en)+'</h3><p>'+esc(p.description_en||'Product details available on request.')+'</p><strong>'+esc(p.currency)+' '+esc(p.retail_price)+'</strong><p class="muted">B2B: '+esc(p.currency)+' '+esc(p.b2b_price)+(p.group_price?' · Group: '+esc(p.currency)+' '+esc(p.group_price):'')+'</p></article>').join('')+'</div>':'<div class="notice"><h3>Products will appear here</h3><p>The storefront reads active products from MySQL. Add products through the protected admin API or upcoming admin product form.</p></div>';
  const content='<section class="section"><div class="section-head"><div><p class="eyebrow">CURATED FOR GLOBAL BUYERS</p><h2>Featured products</h2></div><span class="pill">Currency: CNY</span></div>'+productCards+'</section><section id="groups" class="section split"><div><p class="eyebrow">BUY TOGETHER, SAVE TOGETHER</p><h2>Group buying</h2><p>Campaigns will connect target quantities, group pricing and participant progress to the shared order system.</p></div>'+card('Group buying campaigns','Group pricing and campaign status will be displayed when campaigns are activated.','/login','Sign in')+'</section><section id="b2b" class="section split"><div><p class="eyebrow">FOR BUSINESS BUYERS</p><h2>Wholesale & B2B</h2><p>Request volume pricing, product specifications and sourcing support.</p></div>'+formFields('business')+'</section>';
  return res.send(shell('A smarter way to source and shop.','Discover products, access wholesale pricing and connect with sourcing and logistics services.',content,user,'mall'));
});

app.listen(PORT, () => console.log('Cprime Mall listening on port ' + PORT));
