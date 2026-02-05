# Fix Database Connection Error

## Current Issue

The error occurs because:
1. **Both `DATABASE_URL` and `DB_*` variables are set** in your `.env` file
2. **`DATABASE_URL` takes precedence** - so it's using `89.116.21.112:3306`
3. **The database server is unreachable** - connection timeout

## Solution Options

### Option 1: Remove DATABASE_URL (Use DB_* Variables)

Since you have `DB_*` variables set (lines 2-6), remove or comment out `DATABASE_URL`:

**In `.env` file:**
```env
# Comment out or remove this line:
# DATABASE_URL="mysql://customer:Kalbazaar@177@89.116.21.112:3306/customer_db"

# Keep these (lines 2-6):
DB_HOST=89.116.21.112
DB_PORT=3306
DB_USER=customer
DB_PASSWORD=Kalbazaar@177
DB_NAME=customer_db
```

**Then restart your dev server:**
```bash
npm run dev
```

### Option 2: Fix Database Server Connection

If you need to use the remote database at `89.116.21.112:3306`:

1. **Check if database server is running:**
   ```bash
   ping 89.116.21.112
   nc -zv -w 3 89.116.21.112 3306
   ```

2. **Verify firewall rules** allow connections from your IP

3. **Check database server logs** for connection attempts

4. **Contact database administrator** if server is down

### Option 3: Use Local Database (Development)

For local development, use Docker:

```bash
# Start local MySQL
docker-compose up -d mysql

# Update .env to use localhost
DB_HOST=localhost
DB_PORT=3306
DB_USER=customer
DB_PASSWORD=Kalbazaar@177
DB_NAME=customer_db

# Remove DATABASE_URL or comment it out
# DATABASE_URL="..."

# Run migrations
npx prisma db push
```

## How Configuration Works

The system checks in this order:

1. **First:** `DATABASE_URL` (if set) → Uses this
2. **Second:** `DB_*` variables (if `DATABASE_URL` not set) → Constructs URL from these

**Current situation:**
- ✅ `DATABASE_URL` is set → Using this (points to unreachable server)
- ✅ `DB_*` variables are set → Not used (because `DATABASE_URL` takes precedence)

## Quick Fix

**To use DB_* variables instead:**

1. Open `.env` file
2. Comment out or remove the `DATABASE_URL` line
3. Keep `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
4. Restart dev server

The system will automatically construct the connection URL from `DB_*` variables.

## Verify Configuration

After making changes, verify:

```bash
# Check environment variables
node -e "require('dotenv').config(); console.log('DB_HOST:', process.env.DB_HOST); console.log('Using DATABASE_URL:', !!process.env.DATABASE_URL);"
```

Expected output if using DB_* variables:
```
DB_HOST: 89.116.21.112
Using DATABASE_URL: false
```
