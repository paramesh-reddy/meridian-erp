# Meridian ERP — Sales & Inventory Management System

React frontend and FastAPI backend for products, customers, inventory, sales orders, and manager approval.

There is no Docker setup. One database is created automatically the first time the API starts, and the seed data is inserted only when that database is empty.

## Start

From this folder:

```bash
npm install
npm run dev
```

Open http://localhost:5173

| Role | Email | Password |
| :--- | :--- | :--- |
| Admin | `admin@example.com` | `Password123!` |
| Manager | `manager@example.com` | `Password123!` |
| Sales | `sales@example.com` | `Password123!` |

The API docs are at http://localhost:8000/docs.

## Folders

```text
frontend/     React + Vite
backend/      FastAPI + Python
scripts/      npm run dev launcher
```

`npm install` installs the React app. `npm run dev` creates the Python environment on first run, starts FastAPI on port 8000, then starts the React app on port 5173.

## Database

The default database is a local file at `backend/data/meridian.db`. This machine does not need MySQL or Docker to run the app.

To use MySQL instead, create a database named `sales_inventory` and set this in `backend/.env`:

```text
DATABASE_URL=mysql+pymysql://root:password@localhost:3306/sales_inventory
```

Tables are created on startup. Restarting the app does not insert the demo users, products, or customers again.

## What the app does

- Sign in with JWT access and refresh tokens. Roles are Admin, Manager, and Sales Employee.
- Products, customers, and inventory adjustments.
- Sales orders calculate totals on the server and check stock inside a transaction.
- Orders at or below ₹50,000 are confirmed and stock is deducted.
- Orders above ₹50,000 are held for manager approval, stock is reserved, and the manager is emailed.
- Approve deducts the reserved stock and emails the sales user. Reject releases the stock and emails the reason.
- Dashboards show sales, orders, approvals, and inventory.

Email uses the SMTP settings in `backend/.env`. Until those are real mailbox credentials, messages are stored in the email log as simulated deliveries.
