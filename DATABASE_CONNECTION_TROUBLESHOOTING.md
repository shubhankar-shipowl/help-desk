# Database Connection Troubleshooting Guide

## Error: "Can't reach database server at `89.116.21.112:3306`"

This error occurs when your application cannot connect to the MySQL database server.

## Quick Diagnosis

### 1. Check Database Server Status
```bash
# Test if server is reachable
ping 89.116.21.112

# Test MySQL port
nc -zv -w 3 89.116.21.112 3306
```

### 2. Verify DATABASE_URL
Check your `.env` file:
```bash
grep DATABASE_URL .env
```

Expected format:
```
DATABASE_URL="mysql://username:password@host:port/database"
```

## Common Causes & Solutions

### 1. Database Server is Down
**Solution:** Contact your database administrator or hosting provider to verify the server is running.

### 2. Firewall Blocking Connection
**Solution:** 
- Check if port 3306 is open on the database server
- Verify your IP is whitelisted in the database firewall rules
- Check if your network/router allows outbound connections on port 3306

### 3. Wrong IP Address or Port
**Solution:**
- Verify the correct database server IP address
- Confirm the MySQL port (default is 3306)
- Update `DATABASE_URL` in `.env` if needed

### 4. Database Not Configured for Remote Connections
**Solution:** Ensure MySQL is configured to accept remote connections:
```sql
-- On the database server, check bind-address in my.cnf
-- Should be: bind-address = 0.0.0.0 (or your server IP)
```

### 5. Network Routing Issues
**Solution:** 
- Check if you're on the same network as the database
- Verify VPN connection if required
- Test from a different network to isolate the issue

## Development Solutions

### Option 1: Use Local Database (Recommended for Development)

1. **Start local MySQL with Docker:**
```bash
docker-compose up -d mysql
```

2. **Update `.env`:**
```env
DATABASE_URL="mysql://customer:Kalbazaar@177@localhost:3306/customer_db"
```

3. **Run migrations:**
```bash
npx prisma db push
```

### Option 2: Use Docker Compose (All Services)

```bash
# Start all services including database
docker-compose up -d

# This will use the database URL from docker-compose.yml
# DATABASE_URL="mysql://customer:Kalbazaar@177@mysql:3306/customer_db"
```

### Option 3: Add Connection Timeout Parameters

Update your `DATABASE_URL` to include timeout parameters:
```env
DATABASE_URL="mysql://customer:Kalbazaar@177@89.116.21.112:3306/customer_db?connect_timeout=30&pool_timeout=30&socket_timeout=30"
```

Or run the fix script:
```bash
npm run fix:db-timeout
```

## Testing Database Connection

### Using MySQL Client
```bash
mysql -h 89.116.21.112 -P 3306 -u customer -p customer_db
```

### Using Prisma Studio
```bash
npx prisma studio
```

### Check Connection from Node.js
```javascript
const mysql = require('mysql2/promise');

async function testConnection() {
  try {
    const connection = await mysql.createConnection({
      host: '89.116.21.112',
      port: 3306,
      user: 'customer',
      password: 'Kalbazaar@177',
      database: 'customer_db'
    });
    console.log('✅ Connected successfully!');
    await connection.end();
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
  }
}

testConnection();
```

## Production Considerations

1. **Use Connection Pooling:** Already configured in `lib/prisma.ts`
2. **Monitor Connection Health:** Add health check endpoints
3. **Use Read Replicas:** For better performance and redundancy
4. **Implement Retry Logic:** For transient connection failures
5. **Set Up Alerts:** Monitor database connectivity

## Still Having Issues?

1. Check server logs on the database server
2. Verify MySQL user permissions
3. Check MySQL error logs: `/var/log/mysql/error.log`
4. Test connection from the database server itself
5. Contact your database administrator

## Emergency Workaround

If you need to continue development without database access:

1. Use mock data in development
2. Implement offline mode with local storage
3. Use a different database instance temporarily
