# SafeSpot Sentinel Global V2 - Enterprise Backend

Enterprise-grade security application backend with PostgreSQL, PostGIS, WebSocket real-time features, OAuth2, 2FA, RBAC, and GDPR compliance.

## 🏗️ Architecture

- **Framework**: Fastify with TypeScript
- **Database**: PostgreSQL 15 + PostGIS 3.4
- **Cache**: Redis for sessions and rate limiting  
- **Real-time**: WebSocket with Socket.IO
- **Authentication**: JWT + OAuth2 + 2FA (TOTP/SMS)
- **Authorization**: RBAC with granular permissions
- **Monitoring**: OpenTelemetry + Prometheus + Structured logging
- **Payments**: Stripe integration with webhooks
- **Compliance**: GDPR-compliant data handling

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- PostgreSQL 15 with PostGIS
- Redis 7

### Installation

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your configuration
nano .env

# Start infrastructure services
docker-compose up -d postgres redis

# Generate Prisma client
npm run generate

# Run database migrations
npm run migrate

# Seed database with test data
npm run seed

# Start development server
npm run dev
```

## 📁 Project Structure

```
src/
├── auth/           # JWT, 2FA, OAuth2 authentication
├── cache/          # Redis caching and session management
├── config/         # Environment configuration with Zod validation
├── database/       # Prisma ORM connection and utilities
├── integrations/   # External service integrations (Stripe, SMS, Email)
├── middleware/     # Authentication, RBAC, rate limiting
├── models/         # Database schemas and validation
├── observability/  # OpenTelemetry, metrics, monitoring
├── routes/         # API endpoints organized by domain
├── schedulers/     # Background jobs and data cleanup
├── security/       # Encryption, hashing, GDPR compliance
├── utils/          # Logging, utilities
└── websocket/      # Real-time WebSocket server
```

## 🔑 Key Features

### 🛡️ Security First

- **Authentication**: JWT with refresh token rotation
- **2FA**: TOTP + SMS + backup codes
- **OAuth2**: Google and Apple Sign-In
- **Encryption**: AES-256 for sensitive data
- **Rate Limiting**: IP and user-based with Redis
- **CSRF Protection**: Token validation
- **Security Headers**: Helmet.js configuration

### 🗄️ Database & Geospatial

- **PostGIS**: Advanced geospatial queries
- **Prisma ORM**: Type-safe database access
- **Migrations**: Version-controlled schema changes
- **Spatial Indexing**: Optimized for location queries
- **Data Retention**: GDPR-compliant cleanup

### ⚡ Real-time Features

- **WebSocket**: Authenticated connections
- **Channel-based**: Scalable pub/sub messaging
- **SOS Tracking**: Live location updates
- **Report Streaming**: Real-time incident updates
- **Connection Management**: Automatic cleanup

### 🔧 Enterprise Features

- **RBAC**: Role-based access control
- **Audit Logging**: Complete action tracking
- **Monitoring**: Prometheus metrics + OpenTelemetry
- **Health Checks**: Comprehensive system monitoring
- **Background Jobs**: Automated maintenance tasks
- **API Documentation**: OpenAPI/Swagger integration

## 🌐 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Token refresh
- `POST /api/auth/2fa/setup` - Setup 2FA
- `GET /api/auth/me` - Current user info

### SOS Emergency System
- `POST /api/sos/start` - Start emergency session
- `POST /api/sos/heartbeat` - Update location
- `POST /api/sos/end` - End emergency
- `GET /api/sos/track/:sessionId` - Track session

### Community Reports
- `GET /api/reports` - Get reports (geospatial)
- `POST /api/reports` - Create report (AI moderated)
- `POST /api/reports/:id/vote` - Vote on report
- `GET /api/reports/my/reports` - User's reports

### Payments
- `POST /api/payments/checkout` - Create Stripe session
- `GET /api/payments/subscription` - Subscription status
- `POST /api/payments/subscription/cancel` - Cancel subscription

### Geographic Zones
- `GET /api/zones` - Get safety zones (PostGIS)
- `GET /api/zones/nearby` - Proximity search
- `GET /api/zones/check-safety` - Check point safety

### User Management
- `PATCH /api/users/profile` - Update profile
- `POST /api/users/contacts` - Add emergency contact
- `POST /api/users/export` - GDPR data export
- `DELETE /api/users/account` - Delete account

### Admin
- `GET /api/admin/dashboard` - Admin statistics
- `GET /api/admin/reports/pending` - Moderation queue
- `POST /api/admin/reports/:id/moderate` - Moderate report
- `GET /api/admin/audit` - Audit logs

## 🔌 WebSocket Events

### Connection
```javascript
// Connect and authenticate
const socket = io('wss://api.safespot.com/ws');
socket.emit('auth', { token: 'jwt_token' });
```

### Channels
```javascript
// Join real-time channels
socket.emit('join_channel', { channel: 'reports:global' });
socket.emit('join_channel', { channel: 'sos:session_id' });
```

### Events
- `new_report` - New community report
- `sos_alert` - Emergency alert
- `sos_location_update` - Live location tracking
- `weather_alert` - Weather warnings

## 🏃‍♂️ Available Scripts

```bash
# Development
npm run dev              # Start development server with hot reload
npm run ws:dev          # Start WebSocket server only

# Database
npm run migrate         # Run Prisma migrations
npm run migrate:deploy  # Deploy migrations (production)
npm run migrate:reset   # Reset database
npm run seed           # Seed database with test data
npm run generate       # Generate Prisma client

# Build & Production
npm run build          # Build for production
npm run start          # Start production server

# Testing
npm run test           # Run tests
npm run test:e2e       # End-to-end tests
npm run test:security  # Security audit tests

# Quality
npm run lint           # ESLint
npm run type-check     # TypeScript validation

# Utilities
npm run backup         # Database backup
npm run restore        # Database restore
npm run openapi        # Generate OpenAPI spec
```

## 🌍 Environment Variables

Critical environment variables (see `.env.example`):

```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/safespot_v2"

# Redis
REDIS_URL="redis://localhost:6379"

# Security
JWT_SECRET="your-super-secure-secret-key"
ENCRYPTION_KEY="your-32-byte-aes-256-key"

# Integrations
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
OPENWEATHER_API_KEY="your-weather-api-key"

# Firebase (Push Notifications)
FIREBASE_PROJECT_ID="your-project-id"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
FIREBASE_CLIENT_EMAIL="firebase-admin@project.iam.gserviceaccount.com"

# Email & SMS
SMTP_HOST="smtp.gmail.com"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"

TWILIO_ACCOUNT_SID="your-twilio-sid"
TWILIO_AUTH_TOKEN="your-twilio-token"
```

## 📊 Monitoring & Observability

### Health Checks
- `GET /health` - Basic health status
- `GET /api/admin/health/detailed` - Comprehensive health check

### Metrics (Prometheus)
- `GET /metrics` - Prometheus metrics endpoint

### Monitoring Dashboard
The application provides comprehensive monitoring:

- **Request Metrics**: Response times, error rates
- **Business Metrics**: SOS sessions, reports, user activity
- **System Metrics**: Memory, CPU, database performance
- **Security Events**: Failed logins, rate limits, suspicious activity

## 🔐 Security Considerations

### Authentication Flow
1. User registers/logs in with email/password
2. Optional 2FA challenge (TOTP/SMS)
3. JWT access token (15min) + refresh token (7d)
4. Token rotation on refresh
5. Session tracking and revocation

### Data Protection
- Sensitive data encrypted at rest (AES-256)
- PII anonymization for GDPR compliance
- Secure headers (CSP, HSTS, etc.)
- Input validation and sanitization
- SQL injection prevention (Prisma ORM)

### Rate Limiting
- Global: 100 requests/15min per IP
- Authentication: 5 attempts/hour per IP
- SOS: Emergency bypass for critical functions
- WebSocket: Connection limits per user

## 🌐 Deployment

### Production Checklist
- [ ] Set `NODE_ENV=production`
- [ ] Configure secure JWT secrets
- [ ] Set up PostgreSQL with PostGIS
- [ ] Configure Redis cluster
- [ ] Set up SSL/TLS certificates
- [ ] Configure monitoring (Prometheus/Grafana)
- [ ] Set up log aggregation
- [ ] Configure backup strategy
- [ ] Test disaster recovery procedures

### Docker Deployment
```bash
# Build production image
docker build -t safespot-backend-v2 .

# Run with docker-compose
docker-compose -f docker-compose.prod.yml up -d
```

### Environment-specific Configuration
- **Development**: SQLite + local Redis
- **Staging**: Managed PostgreSQL + Redis
- **Production**: Multi-zone PostgreSQL + Redis Cluster

## 🧪 Testing

### Test Structure
```bash
src/tests/
├── unit/           # Unit tests for services
├── integration/    # API integration tests
├── e2e/           # End-to-end workflows
└── security/      # Security-specific tests
```

### Running Tests
```bash
# All tests
npm test

# Specific test suites
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:security

# Coverage
npm run test:coverage
```

## 📈 Performance

### Optimization Strategies
- **Database**: Proper indexing, query optimization
- **Caching**: Redis for sessions, rate limiting, hot data
- **WebSocket**: Connection pooling, message batching
- **API**: Request/response compression, pagination
- **Monitoring**: Performance metrics, alerting

### Scalability
- **Horizontal**: Load balancer + multiple app instances
- **Database**: Read replicas for reports/zones queries
- **Cache**: Redis cluster for session distribution
- **WebSocket**: Socket.IO with Redis adapter for clustering

## 🛠️ Development

### Code Style
- **TypeScript**: Strict mode with comprehensive types
- **ESLint**: Airbnb configuration with security rules
- **Prettier**: Consistent code formatting
- **Conventional Commits**: Standardized commit messages

### Adding New Features
1. Create feature branch from `main`
2. Implement with tests
3. Update API documentation
4. Add migration if database changes
5. Update environment variables if needed
6. Create pull request with comprehensive description

## 📚 Additional Resources

- [Prisma Documentation](https://www.prisma.io/docs/)
- [Fastify Documentation](https://www.fastify.io/docs/)
- [PostGIS Documentation](https://postgis.net/documentation/)
- [OpenTelemetry Node.js](https://opentelemetry.io/docs/instrumentation/js/)
- [Stripe API Documentation](https://stripe.com/docs/api)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Ensure security review compliance
5. Submit a pull request

## 📄 License

Enterprise License - SafeSpot Sentinel Global V2

---

**🚨 Emergency Features Ready for Production**
This backend provides enterprise-grade security and real-time capabilities for protecting users worldwide.