import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.env');

try {
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, 'utf8');
    
    // Look for DATABASE_URL
    const dbUrlMatch = envContent.match(/DATABASE_URL=(.*)/);
    
    if (dbUrlMatch) {
      let currentUrl = dbUrlMatch[1];
      // Remove quotes if present
      currentUrl = currentUrl.replace(/^["']|["']$/g, '');
      
      console.log('Found DATABASE_URL. Checking for timeouts...');
      
      let newUrl = currentUrl;
      const hasQueryParams = currentUrl.includes('?');
      
      // key parameters to add/ensure
      const params = {
        'connect_timeout': '30',
        'pool_timeout': '30',
        'socket_timeout': '30'
      };
      
      let finalUrl = currentUrl;
      
      if (!hasQueryParams) {
        finalUrl += '?connect_timeout=30&pool_timeout=30&socket_timeout=30';
      } else {
        // Simple append for now to avoid complex parsing logic of existing params
        // Check if params exist, if not append them
        const joiner = '&';
        Object.entries(params).forEach(([key, value]) => {
          if (!finalUrl.includes(key)) {
            finalUrl += `${joiner}${key}=${value}`;
          }
        });
      }
      
      if (finalUrl !== currentUrl) {
        // Escape check: verify it's still a valid-looking URL string parts
        
        // Update the file content
        // We use a regex to replace the line to preserve the rest of the file
        const newEnvContent = envContent.replace(
          /^DATABASE_URL=.*/m,
          `DATABASE_URL="${finalUrl}"`
        );
        
        fs.writeFileSync(envPath, newEnvContent);
        console.log('✅ Updated DATABASE_URL with increased timeouts (30s).');
        console.log('New configuration saved to .env');
      } else {
        console.log('ℹ️ DATABASE_URL already has timeout parameters.');
      }
      
    } else {
      console.log('❌ DATABASE_URL not found in .env');
    }
  } else {
    console.log('❌ .env file not found');
  }
} catch (error) {
  console.error('Error updating .env:', error);
}
