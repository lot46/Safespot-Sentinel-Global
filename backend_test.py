#!/usr/bin/env python3
"""
SafeSpot Sentinel Global - Backend API Testing Suite
Tests all critical API endpoints including authentication, SOS, reports, contacts, and payments.
"""

import requests
import sys
import json
from datetime import datetime
import time

class SafeSpotAPITester:
    def __init__(self, base_url="https://sentinel-app-2.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.token = None
        self.user_data = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        
        # Test data
        self.test_user = {
            "email": "test@safespotglobal.com",
            "password": "SecurePass123!",
            "full_name": "Jean Dupont",
            "phone": "+33123456789"
        }

    def log_result(self, test_name, success, details="", response_data=None):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {test_name} - PASSED")
            if details:
                print(f"   {details}")
        else:
            self.failed_tests.append({
                "test": test_name,
                "details": details,
                "response": response_data
            })
            print(f"❌ {test_name} - FAILED")
            print(f"   {details}")
        print()

    def make_request(self, method, endpoint, data=None, expected_status=200):
        """Make HTTP request with proper headers"""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        headers = {'Content-Type': 'application/json'}
        
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=30)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=30)
            
            success = response.status_code == expected_status
            response_data = None
            
            try:
                response_data = response.json()
            except:
                response_data = {"raw_response": response.text}
            
            return success, response.status_code, response_data
            
        except Exception as e:
            return False, 0, {"error": str(e)}

    def test_health_check(self):
        """Test if API is accessible"""
        try:
            response = requests.get(f"{self.base_url.replace('/api', '')}/", timeout=10)
            success = response.status_code in [200, 404]  # 404 is OK, means server is running
            self.log_result("API Health Check", success, 
                          f"Server responding (Status: {response.status_code})")
        except Exception as e:
            self.log_result("API Health Check", False, f"Server not accessible: {str(e)}")

    def test_user_registration(self):
        """Test user registration"""
        success, status, data = self.make_request('POST', '/auth/register', self.test_user, 200)
        
        if success and 'access_token' in data:
            self.token = data['access_token']
            self.user_data = data.get('user', {})
            self.log_result("User Registration", True, 
                          f"User registered successfully, token received")
        else:
            # Try to login if user already exists
            if status == 400 and "already registered" in str(data):
                self.log_result("User Registration", True, 
                              "User already exists (expected for repeated tests)")
                return self.test_user_login()
            else:
                self.log_result("User Registration", False, 
                              f"Status: {status}, Response: {data}")

    def test_user_login(self):
        """Test user login"""
        login_data = {
            "email": self.test_user["email"],
            "password": self.test_user["password"]
        }
        
        success, status, data = self.make_request('POST', '/auth/login', login_data, 200)
        
        if success and 'access_token' in data:
            self.token = data['access_token']
            self.user_data = data.get('user', {})
            self.log_result("User Login", True, 
                          f"Login successful, token received")
        else:
            self.log_result("User Login", False, 
                          f"Status: {status}, Response: {data}")

    def test_get_user_profile(self):
        """Test getting user profile"""
        if not self.token:
            self.log_result("Get User Profile", False, "No authentication token available")
            return
            
        success, status, data = self.make_request('GET', '/me', expected_status=200)
        
        if success and 'email' in data:
            self.log_result("Get User Profile", True, 
                          f"Profile retrieved: {data.get('full_name', 'Unknown')}")
        else:
            self.log_result("Get User Profile", False, 
                          f"Status: {status}, Response: {data}")

    def test_create_emergency_contact(self):
        """Test creating emergency contact"""
        if not self.token:
            self.log_result("Create Emergency Contact", False, "No authentication token available")
            return
            
        contact_data = {
            "name": "Marie Dupont",
            "phone": "+33987654321",
            "email": "marie@example.com",
            "relationship": "family"
        }
        
        success, status, data = self.make_request('POST', '/contacts', contact_data, 200)
        
        if success and 'id' in data:
            self.contact_id = data['id']
            self.log_result("Create Emergency Contact", True, 
                          f"Contact created: {data.get('name', 'Unknown')}")
        else:
            self.log_result("Create Emergency Contact", False, 
                          f"Status: {status}, Response: {data}")

    def test_get_emergency_contacts(self):
        """Test getting emergency contacts"""
        if not self.token:
            self.log_result("Get Emergency Contacts", False, "No authentication token available")
            return
            
        success, status, data = self.make_request('GET', '/contacts', expected_status=200)
        
        if success and isinstance(data, list):
            self.log_result("Get Emergency Contacts", True, 
                          f"Retrieved {len(data)} contacts")
        else:
            self.log_result("Get Emergency Contacts", False, 
                          f"Status: {status}, Response: {data}")

    def test_create_report_with_ai_moderation(self):
        """Test creating report with AI moderation"""
        if not self.token:
            self.log_result("Create Report with AI Moderation", False, "No authentication token available")
            return
            
        report_data = {
            "type": "crime",
            "title": "Test incident report",
            "description": "This is a test report for SafeSpot Sentinel Global testing purposes",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "address": "Paris, France"
        }
        
        success, status, data = self.make_request('POST', '/reports', report_data, 200)
        
        if success and 'id' in data:
            trust_score = data.get('trust_score', 0)
            ai_status = data.get('status', 'unknown')
            self.report_id = data['id']
            self.log_result("Create Report with AI Moderation", True, 
                          f"Report created with AI moderation - Trust Score: {trust_score}, Status: {ai_status}")
        else:
            self.log_result("Create Report with AI Moderation", False, 
                          f"Status: {status}, Response: {data}")

    def test_get_reports(self):
        """Test getting reports"""
        success, status, data = self.make_request('GET', '/reports', expected_status=200)
        
        if success and isinstance(data, list):
            self.log_result("Get Reports", True, 
                          f"Retrieved {len(data)} reports")
        else:
            self.log_result("Get Reports", False, 
                          f"Status: {status}, Response: {data}")

    def test_sos_system(self):
        """Test SOS system"""
        if not self.token:
            self.log_result("SOS System", False, "No authentication token available")
            return
            
        sos_data = {
            "message": "URGENCE - Test SOS pour SafeSpot Sentinel Global",
            "latitude": 48.8566,
            "longitude": 2.3522
        }
        
        success, status, data = self.make_request('POST', '/sos/start', sos_data, 200)
        
        if success and 'id' in data:
            sos_id = data['id']
            contacts_notified = data.get('contacts_notified', [])
            self.log_result("SOS System - Start", True, 
                          f"SOS started, ID: {sos_id}, Contacts notified: {len(contacts_notified)}")
            
            # Test ending SOS
            success_end, status_end, data_end = self.make_request('POST', f'/sos/{sos_id}/end', expected_status=200)
            
            if success_end:
                self.log_result("SOS System - End", True, "SOS session ended successfully")
            else:
                self.log_result("SOS System - End", False, 
                              f"Status: {status_end}, Response: {data_end}")
        else:
            self.log_result("SOS System - Start", False, 
                          f"Status: {status}, Response: {data}")

    def test_weather_alerts(self):
        """Test weather alerts"""
        success, status, data = self.make_request('GET', '/weather/alerts?lat=48.8566&lon=2.3522', expected_status=200)
        
        if success and isinstance(data, list):
            self.log_result("Weather Alerts", True, 
                          f"Retrieved {len(data)} weather alerts")
        else:
            self.log_result("Weather Alerts", False, 
                          f"Status: {status}, Response: {data}")

    def test_payment_system(self):
        """Test payment system"""
        if not self.token:
            self.log_result("Payment System", False, "No authentication token available")
            return
            
        # Test monthly plan
        success, status, data = self.make_request('POST', '/payments/checkout?plan=premium_monthly', expected_status=200)
        
        if success and 'url' in data and 'session_id' in data:
            session_id = data['session_id']
            self.log_result("Payment System - Checkout", True, 
                          f"Checkout session created: {session_id}")
            
            # Test payment status
            success_status, status_code, status_data = self.make_request('GET', f'/payments/status/{session_id}', expected_status=200)
            
            if success_status:
                payment_status = status_data.get('payment_status', 'unknown')
                self.log_result("Payment System - Status", True, 
                              f"Payment status retrieved: {payment_status}")
            else:
                self.log_result("Payment System - Status", False, 
                              f"Status: {status_code}, Response: {status_data}")
        else:
            self.log_result("Payment System - Checkout", False, 
                          f"Status: {status}, Response: {data}")

    def run_all_tests(self):
        """Run all tests in sequence"""
        print("🚀 Starting SafeSpot Sentinel Global Backend API Tests")
        print("=" * 60)
        print()
        
        # Basic connectivity
        self.test_health_check()
        
        # Authentication flow
        self.test_user_registration()
        self.test_user_login()
        self.test_get_user_profile()
        
        # Emergency contacts
        self.test_create_emergency_contact()
        self.test_get_emergency_contacts()
        
        # Reports with AI moderation
        self.test_create_report_with_ai_moderation()
        self.test_get_reports()
        
        # SOS system
        self.test_sos_system()
        
        # Weather alerts
        self.test_weather_alerts()
        
        # Payment system
        self.test_payment_system()
        
        # Final results
        self.print_summary()

    def print_summary(self):
        """Print test summary"""
        print("=" * 60)
        print("🏁 TEST SUMMARY")
        print("=" * 60)
        print(f"Total Tests: {self.tests_run}")
        print(f"Passed: {self.tests_passed}")
        print(f"Failed: {len(self.failed_tests)}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%" if self.tests_run > 0 else "0%")
        print()
        
        if self.failed_tests:
            print("❌ FAILED TESTS:")
            print("-" * 40)
            for failure in self.failed_tests:
                print(f"• {failure['test']}")
                print(f"  Details: {failure['details']}")
                if failure['response']:
                    print(f"  Response: {json.dumps(failure['response'], indent=2)[:200]}...")
                print()
        
        if self.tests_passed == self.tests_run:
            print("🎉 ALL TESTS PASSED! Backend API is fully functional.")
        else:
            print(f"⚠️  {len(self.failed_tests)} tests failed. Review the issues above.")
        
        return len(self.failed_tests) == 0

def main():
    """Main test execution"""
    print("SafeSpot Sentinel Global - Backend API Test Suite")
    print(f"Testing against: https://sentinel-app-2.preview.emergentagent.com/api")
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    tester = SafeSpotAPITester()
    success = tester.run_all_tests()
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())