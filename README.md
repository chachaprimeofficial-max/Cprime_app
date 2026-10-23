# Cprime Mall — CHACHA PRIME

A unified Node.js + Express + MySQL foundation for the ChachaPrime corporate site, storefront, services portal, supplier workspace and admin control panel.

## Architecture

One Express application can serve all five hostnames using the HTTP Host header, with one shared MySQL database and role-checked APIs.

- `corporate.chachaprime.com` — corporate profile, company information, contact and consultation inquiries
- `chachaprime.com` — product storefront, customer account and product data API
- `services.chachaprime.com` — sourcing, shipping, visa and business-service inquiry forms
- `source.chachaprime.com` — staff/sourcing supplier workspace
- `admin.chachaprime.com` — admin dashboard and protected management APIs

English and Simplified Chinese fields are included for product data and user preferences. The initial UI is English; full interface localization is a follow-up implementation item. Default currency is CNY. Payment gateway integration is intentionally postponed.

## Requirements

- Node.js 20+
- MySQL 8+ or compatible MariaDB
- HTTPS and DNS records for all hostnames in production

## Local setup

1. Copy `.env.example` to `.env` and set strong secrets/database credentials.
2. Create a database user with access only to the `cprime_mall` database.
3. Run `mysql -u YOUR_DB_USER -p < db/schema.sql` using a MySQL account allowed to create the database, or create the database separately and run the schema.
4. Run `npm install`.
5. Run `npm run check`.
6. Run `npm start`.
7. Visit `http://localhost:3000/?site=mall`, or use `?site=corporate`, `?site=services`, `?site=source`, and `?site=admin` to preview each section locally.

## Important security and production notes

- Do not commit `.env`, database passwords, SMTP credentials, or signing keys.
- Public registration always creates a customer. Never promote users to admin through public registration.
- Create the first administrator through a one-time, secure provisioning script or direct controlled database operation; do not use a public default password.
- The built-in Express MemoryStore is for development only. Configure a persistent shared session store before production and multi-instance deployment.
- Configure HTTPS, secure cookies, backups, least-privilege database credentials, upload validation/storage, CSRF protection for browser form actions, and a reverse proxy with correct host routing before going live.
- Do not log passwords, OTP values, session cookies, payment details or sensitive message contents.
- Service requests and supplier records are saved to MySQL; payment processing is not implemented.
- The current starter contains the core schema, domain routing, authentication starter, product read/create APIs, service request intake, supplier intake, and an admin overview. Complete order placement/cart checkout, group-buy participation, full CRUD screens, bilingual UI, file uploads, staff management, email delivery, audit review screens, Android app, automated tests and production deployment still need to be implemented and verified.

## Hostinger deployment overview

Point all five DNS hostnames to the same application deployment, configure the Node.js app to listen on the provider-assigned port (or set `PORT`), and configure the proxy/vhost so the original Host header reaches Express. Use HTTPS for each hostname. The admin subdomain is separated by hostname and role-protected routes, but production deployment still needs a proper shared session store, CSRF protection, and security review.

## Health check

`GET /health` verifies the server and MySQL connection without returning credentials.
