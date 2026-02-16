# MEGA Storage Setup Guide

This application uses MEGA cloud storage for storing ticket attachments (images and videos). All files are uploaded through the backend to MEGA, ensuring credentials are never exposed to the frontend.

## File Structure in MEGA

Files are organized in the following structure:
```
/app-backups/
  └── help-desk/
        ├── images/              (for image files)
        ├── videos/              (for video files)
        ├── email-attachments/   (for email attachment files)
        └── call-recordings/     (for call recording files)
```

## Environment Variables

Add these to your `.env` file:

```env
MEGA_EMAIL=your-email@example.com
MEGA_PASSWORD=your-mega-password
```

## How It Works

1. **Upload Flow**: 
   - Frontend → Backend API → MEGA Storage
   - Files are never uploaded directly from frontend to MEGA

2. **Storage**:
   - Images go to `/app-backups/help-desk/images/`
   - Videos go to `/app-backups/help-desk/videos/`
   - Email attachments go to `/app-backups/help-desk/email-attachments/`
   - Call recordings go to `/app-backups/help-desk/call-recordings/`
   - Files are organized by ticket/email ID in filename

3. **Database**:
   - Only metadata is stored (file handle, filename, size, MIME type)
   - File URL format: `/api/storage/mega/{fileHandle}`

4. **File Access**:
   - Files are served through authenticated API endpoint: `/api/storage/mega/{fileHandle}`
   - Only authenticated users with access to the ticket can download files
   - MEGA is used as **private storage**, NOT as a public CDN

## Security Features

- ✅ All uploads go through backend (no direct frontend-to-MEGA uploads)
- ✅ MEGA credentials stored only in environment variables (server-side)
- ✅ File access requires authentication
- ✅ Users can only access files from tickets they have permission to view
- ✅ Files are not publicly accessible via direct MEGA links

## API Endpoints

### Upload (Automatic)
Files are automatically uploaded when:
- Creating a ticket with attachments (`POST /api/tickets/public`)
- Creating a ticket as agent (`POST /api/tickets/agent`)
- Adding comment with attachments (`POST /api/tickets/[id]/comments`)

### Download (Authenticated)
- `GET /api/storage/mega/{fileHandle}` - Requires authentication, serves file from MEGA

## Testing

1. Set up MEGA credentials in `.env`
2. Create a ticket with image/video attachments
3. Files should be uploaded to MEGA automatically
4. Files should be accessible through the authenticated endpoint

## Troubleshooting

### Error: "MEGA credentials not configured"
- Ensure `MEGA_EMAIL` and `MEGA_PASSWORD` are set in `.env`
- Restart the application after adding credentials

### Error: "Failed to initialize MEGA storage"
- Check MEGA credentials are correct
- Ensure MEGA account is active
- Check network connectivity to MEGA servers

### Files not uploading
- Check server logs for MEGA upload errors
- Verify MEGA account has sufficient storage space
- Ensure file size is within MEGA limits

