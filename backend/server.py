from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from passlib.context import CryptContext
from jose import JWTError, jwt
import requests
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionResponse, CheckoutStatusResponse, CheckoutSessionRequest

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Configuration
SECRET_KEY = os.environ.get("SECRET_KEY", "your-secret-key-here")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY")
OPENWEATHER_API_KEY = os.environ.get("OPENWEATHER_API_KEY", "demo-key")

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# Create the main app
app = FastAPI(title="SafeSpot Sentinel Global API")
api_router = APIRouter(prefix="/api")

# Stripe Configuration
stripe_checkout = None
if STRIPE_API_KEY:
    stripe_checkout = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url="")

# Models
class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: EmailStr
    full_name: str
    phone: Optional[str] = None
    role: str = "user"
    is_premium: bool = False
    alert_radius: int = 2000  # meters
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    phone: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    user: User

class EmergencyContact(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    phone: str
    email: Optional[str] = None
    relationship: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class EmergencyContactCreate(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    relationship: str

class Report(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    type: str  # crime, harassment, robbery, transport, fire, flood, weather, other
    title: str
    description: str
    latitude: float
    longitude: float
    address: Optional[str] = None
    media_urls: List[str] = []
    status: str = "pending"  # pending, validated, rejected
    trust_score: int = 50
    votes: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ReportCreate(BaseModel):
    type: str
    title: str
    description: str
    latitude: float
    longitude: float
    address: Optional[str] = None

class SOSSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    status: str = "active"  # active, ended
    message: str
    latitude: float
    longitude: float
    contacts_notified: List[str] = []
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    ended_at: Optional[datetime] = None

class SOSCreate(BaseModel):
    message: str
    latitude: float
    longitude: float

class WeatherAlert(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str  # weather, disaster
    title: str
    description: str
    severity: str  # low, medium, high, critical
    latitude: float
    longitude: float
    radius: int  # meters
    expires_at: datetime
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PaymentTransaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    session_id: str
    plan: str  # premium_monthly, premium_yearly
    amount: float
    currency: str = "usd"
    status: str = "pending"  # pending, completed, failed, cancelled
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Authentication functions
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = await db.users.find_one({"id": user_id})
    if user is None:
        raise credentials_exception
    return User(**user)

# AI Moderation
async def moderate_content(text: str) -> Dict[str, Any]:
    """Moderate content using AI"""
    if not EMERGENT_LLM_KEY:
        return {"is_appropriate": True, "trust_score": 70, "reason": "AI moderation not configured"}
    
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=str(uuid.uuid4()),
            system_message="You are a content moderator for a safety app. Analyze the content and respond with a JSON containing: is_appropriate (boolean), trust_score (0-100), and reason (string). Detect inappropriate content, hate speech, fake reports, spam."
        ).with_model("openai", "gpt-4o-mini")
        
        user_message = UserMessage(text=f"Please moderate this safety report: {text}")
        response = await chat.send_message(user_message)
        
        # Try to parse JSON response
        import json
        try:
            result = json.loads(response)
            return result
        except:
            return {"is_appropriate": True, "trust_score": 60, "reason": "Unable to parse AI response"}
    except Exception as e:
        print(f"AI moderation error: {e}")
        return {"is_appropriate": True, "trust_score": 50, "reason": "AI moderation failed"}

# Weather integration
async def get_weather_alerts(lat: float, lon: float) -> List[WeatherAlert]:
    """Get weather alerts from OpenWeatherMap"""
    if OPENWEATHER_API_KEY == "demo-key":
        # Return mock alerts for demo
        return [
            WeatherAlert(
                type="weather",
                title="Thunderstorm Warning",
                description="Severe thunderstorms expected in the area",
                severity="medium",
                latitude=lat,
                longitude=lon,
                radius=5000,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=4)
            )
        ]
    
    try:
        url = f"http://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            alerts = []
            # Process weather data and create alerts if needed
            return alerts
    except Exception as e:
        print(f"Weather API error: {e}")
    
    return []

# Routes

# Authentication
@api_router.post("/auth/register", response_model=Token)
async def register(user: UserCreate):
    # Check if user exists
    existing_user = await db.users.find_one({"email": user.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create user
    hashed_password = get_password_hash(user.password)
    new_user = User(
        email=user.email,
        full_name=user.full_name,
        phone=user.phone
    )
    
    user_dict = new_user.dict()
    user_dict["password_hash"] = hashed_password
    
    await db.users.insert_one(user_dict)
    
    # Create token
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": new_user.id}, expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer", "user": new_user}

@api_router.post("/auth/login", response_model=Token)
async def login(user_credentials: UserLogin):
    user = await db.users.find_one({"email": user_credentials.email})
    if not user or not verify_password(user_credentials.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["id"]}, expires_delta=access_token_expires
    )
    
    user_obj = User(**user)
    return {"access_token": access_token, "token_type": "bearer", "user": user_obj}

# User profile
@api_router.get("/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

@api_router.put("/me", response_model=User)
async def update_user_profile(updates: dict, current_user: User = Depends(get_current_user)):
    updates["updated_at"] = datetime.now(timezone.utc)
    await db.users.update_one({"id": current_user.id}, {"$set": updates})
    updated_user = await db.users.find_one({"id": current_user.id})
    return User(**updated_user)

# Emergency contacts
@api_router.get("/contacts", response_model=List[EmergencyContact])
async def get_emergency_contacts(current_user: User = Depends(get_current_user)):
    contacts = await db.emergency_contacts.find({"user_id": current_user.id}).to_list(100)
    return [EmergencyContact(**contact) for contact in contacts]

@api_router.post("/contacts", response_model=EmergencyContact)
async def create_emergency_contact(contact: EmergencyContactCreate, current_user: User = Depends(get_current_user)):
    new_contact = EmergencyContact(
        user_id=current_user.id,
        **contact.dict()
    )
    await db.emergency_contacts.insert_one(new_contact.dict())
    return new_contact

@api_router.delete("/contacts/{contact_id}")
async def delete_emergency_contact(contact_id: str, current_user: User = Depends(get_current_user)):
    result = await db.emergency_contacts.delete_one({"id": contact_id, "user_id": current_user.id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contact not found")
    return {"message": "Contact deleted"}

# Reports
@api_router.get("/reports", response_model=List[Report])
async def get_reports(
    lat: Optional[float] = None,
    lon: Optional[float] = None,
    radius: Optional[int] = 5000,
    report_type: Optional[str] = None,
    limit: int = 50
):
    query = {"status": "validated"}
    if report_type:
        query["type"] = report_type
    
    # For simplicity, not implementing geo queries yet
    reports = await db.reports.find(query).limit(limit).sort("created_at", -1).to_list(limit)
    return [Report(**report) for report in reports]

@api_router.post("/reports", response_model=Report)
async def create_report(report: ReportCreate, current_user: User = Depends(get_current_user)):
    # Moderate content
    moderation = await moderate_content(f"{report.title}. {report.description}")
    
    new_report = Report(
        user_id=current_user.id,
        **report.dict(),
        status="validated" if moderation["is_appropriate"] else "pending",
        trust_score=moderation["trust_score"]
    )
    
    await db.reports.insert_one(new_report.dict())
    return new_report

@api_router.get("/reports/{report_id}", response_model=Report)
async def get_report(report_id: str):
    report = await db.reports.find_one({"id": report_id})
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return Report(**report)

# SOS System
@api_router.post("/sos/start", response_model=SOSSession)
async def start_sos(sos: SOSCreate, current_user: User = Depends(get_current_user)):
    # Get user's emergency contacts
    contacts = await db.emergency_contacts.find({"user_id": current_user.id}).to_list(100)
    
    new_sos = SOSSession(
        user_id=current_user.id,
        message=sos.message,
        latitude=sos.latitude,
        longitude=sos.longitude,
        contacts_notified=[contact["id"] for contact in contacts]
    )
    
    await db.sos_sessions.insert_one(new_sos.dict())
    
    # TODO: Send actual SMS/email notifications
    # For now, we'll just log it
    print(f"SOS Alert: {current_user.full_name} needs help at {sos.latitude}, {sos.longitude}")
    for contact in contacts:
        print(f"Notifying {contact['name']} at {contact['phone']}")
    
    return new_sos

@api_router.post("/sos/{session_id}/end")
async def end_sos(session_id: str, current_user: User = Depends(get_current_user)):
    result = await db.sos_sessions.update_one(
        {"id": session_id, "user_id": current_user.id},
        {"$set": {"status": "ended", "ended_at": datetime.now(timezone.utc)}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="SOS session not found")
    return {"message": "SOS session ended"}

# Weather alerts
@api_router.get("/weather/alerts")
async def get_weather_alerts_endpoint(lat: float, lon: float):
    alerts = await get_weather_alerts(lat, lon)
    return alerts

# Payments
@api_router.post("/payments/checkout")
async def create_checkout_session(request: Request, plan: str, current_user: User = Depends(get_current_user)):
    if not stripe_checkout:
        raise HTTPException(status_code=500, detail="Payment system not configured")
    
    # Define pricing
    plans = {
        "premium_monthly": {"amount": 9.99, "currency": "usd", "name": "Premium Monthly"},
        "premium_yearly": {"amount": 99.99, "currency": "usd", "name": "Premium Yearly"}
    }
    
    if plan not in plans:
        raise HTTPException(status_code=400, detail="Invalid plan")
    
    plan_info = plans[plan]
    host_url = str(request.base_url).rstrip('/')
    
    # Update stripe checkout webhook URL
    stripe_checkout.webhook_url = f"{host_url}/api/webhook/stripe"
    
    checkout_request = CheckoutSessionRequest(
        amount=plan_info["amount"],
        currency=plan_info["currency"],
        success_url=f"{host_url}/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{host_url}/cancel",
        metadata={"user_id": current_user.id, "plan": plan}
    )
    
    session = await stripe_checkout.create_checkout_session(checkout_request)
    
    # Store transaction
    transaction = PaymentTransaction(
        user_id=current_user.id,
        session_id=session.session_id,
        plan=plan,
        amount=plan_info["amount"],
        currency=plan_info["currency"]
    )
    
    await db.payment_transactions.insert_one(transaction.dict())
    
    return {"url": session.url, "session_id": session.session_id}

@api_router.get("/payments/status/{session_id}")
async def get_payment_status(session_id: str, current_user: User = Depends(get_current_user)):
    if not stripe_checkout:
        raise HTTPException(status_code=500, detail="Payment system not configured")
    
    status_response = await stripe_checkout.get_checkout_status(session_id)
    
    # Update transaction status
    if status_response.payment_status == "paid":
        await db.payment_transactions.update_one(
            {"session_id": session_id, "user_id": current_user.id},
            {"$set": {"status": "completed", "updated_at": datetime.now(timezone.utc)}}
        )
        
        # Update user to premium
        await db.users.update_one(
            {"id": current_user.id},
            {"$set": {"is_premium": True, "updated_at": datetime.now(timezone.utc)}}
        )
    
    return status_response

@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    if not stripe_checkout:
        return {"status": "disabled"}
    
    body = await request.body()
    signature = request.headers.get("Stripe-Signature")
    
    try:
        webhook_response = await stripe_checkout.handle_webhook(body, signature)
        
        if webhook_response.payment_status == "paid":
            # Update transaction and user premium status
            await db.payment_transactions.update_one(
                {"session_id": webhook_response.session_id},
                {"$set": {"status": "completed", "updated_at": datetime.now(timezone.utc)}}
            )
            
            transaction = await db.payment_transactions.find_one({"session_id": webhook_response.session_id})
            if transaction:
                await db.users.update_one(
                    {"id": transaction["user_id"]},
                    {"$set": {"is_premium": True, "updated_at": datetime.now(timezone.utc)}}
                )
        
        return {"status": "success"}
    except Exception as e:
        print(f"Webhook error: {e}")
        raise HTTPException(status_code=400, detail="Webhook processing failed")

# Include router
app.include_router(api_router)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
from datetime import datetime, timezone

@app.get("/api/health")


@app.get("/api/health")
def health():
    return {"status": "ok", "ts": datetime.now(timezone.utc).isoformat()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
