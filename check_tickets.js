
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTickets() {
  try {
    const tickets = await prisma.ticket.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        ticketNumber: true,
        id: true,
        assignedAgentId: true,
        status: true,
        storeId: true,
        tenantId: true
      }
    });
    
    console.log('Recent Tickets:');
    tickets.forEach(t => {
      console.log(`- ${t.ticketNumber}: Agent=${t.assignedAgentId}, Store=${t.storeId}, Tenant=${t.tenantId}`);
    });

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

checkTickets();
