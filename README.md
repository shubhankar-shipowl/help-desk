# Customer Support Portal

A modern, full-featured customer support ticketing portal with automation, notifications, and integrations.

## Features

- **Multi-role Authentication** (Admin, Agent, Customer)
- **Ticket Management** with full conversation threads
- **Auto-assignment** of tickets to agents
- **Email Notifications** for ticket updates
- **Real-time Notifications** (in-app)
- **Facebook Integration** (webhooks and notifications)
- **CSAT Rating System**
- **Advanced Filtering & Search**
- **Customer Context Panel**
- **Reports & Analytics**

## Tech Stack

- **Frontend**: Next.js 14+ (App Router), React, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes
- **Database**: MySQL 8.0+
- **Cache/Queue**: Redis
- **ORM**: Prisma
- **Authentication**: NextAuth.js
- **Container**: Docker & Docker Compose

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)
- MySQL 8.0+ (or use Docker)
- Redis (or use Docker)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Customer-Support-System
```

2. Copy the environment file:
```bash
cp .env.example .env
```

3. Update `.env` with your configuration:
```env
DATABASE_URL="mysql://customer:Kalbazaar@177@89.116.21.112:3306/customer_db"
REDIS_URL="redis://localhost:6379"
NEXTAUTH_SECRET="your-secret-key-change-in-production"
NEXTAUTH_URL="http://localhost:3000"
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your-email@example.com"
SMTP_PASSWORD="your-app-password"
```

4. Start Docker containers:
```bash
docker-compose up -d
```

5. Install dependencies:
```bash
npm install
```

6. Generate Prisma Client:
```bash
npx prisma generate
```

7. Run database migrations:
```bash
npx prisma db push
```

8. (Optional) Seed the database:
```bash
npm run db:seed
```

9. Start the development server:
```bash
npm run dev
```

10. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Default Users

After seeding, you can use these default accounts:

- **Admin**: admin@example.com / password123
- **Agent**: agent@example.com / password123
- **Customer**: customer@example.com / password123

## Project Structure

```
├── app/                    # Next.js app directory
│   ├── (authenticated)/    # Authenticated routes
│   │   ├── customer/       # Customer-facing pages
│   │   ├── agent/          # Agent-facing pages
│   │   └── admin/           # Admin pages
│   ├── api/                # API routes
│   ├── auth/               # Authentication pages
│   └── layout.tsx          # Root layout
├── components/             # React components
│   ├── ui/                 # shadcn/ui components
│   ├── tickets/            # Ticket-related components
│   └── dashboard/          # Dashboard components
├── lib/                    # Utility functions
│   ├── prisma.ts          # Prisma client
│   ├── redis.ts           # Redis client
│   ├── auth.ts            # NextAuth configuration
│   ├── email.ts           # Email utilities
│   └── automation.ts      # Automation functions
├── prisma/                # Prisma schema and migrations
│   └── schema.prisma      # Database schema
└── types/                 # TypeScript type definitions
```

## Key Features Implementation

### Ticket Management
- Create, view, and update tickets
- Conversation threads with internal notes
- File attachments support
- Status workflow: New → Open → Pending → Resolved → Closed

### Automation
- **Auto-assign**: Round-robin assignment to available agents
- **Auto-resolve**: Automatically resolve inactive tickets
- **Auto-email**: Send acknowledgment and status update emails

### Notifications
- In-app notifications for ticket updates
- Email notifications (configurable)
- Real-time updates via polling

### Facebook Integration
- Webhook support for Facebook page events
- Create notifications from Facebook posts/comments
- Convert Facebook interactions to tickets

## Development

### Database Management

```bash
# View database in Prisma Studio
npm run db:studio

# Create a new migration
npx prisma migrate dev --name migration-name

# Push schema changes (development)
npx prisma db push
```

### Building for Production

```bash
npm run build
npm start
```

## Docker Commands

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# View logs
docker-compose logs -f

# Rebuild containers
docker-compose up -d --build
```

## Environment Variables

See `.env.example` for all required environment variables.

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.

