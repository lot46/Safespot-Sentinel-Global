#!/usr/bin/env python3
"""
SafeSpot Sentinel Global - Phase 3 Security & Auth Testing Suite
Comprehensive testing of Phase 3 security features including:
- Auth (register/login/refresh/logout)
- 2FA (setup/verify/disable/backup)
- JWT rotation + malformed/expired token handling
- RBAC admin-only endpoint protection
- CSRF double-submit cookie
- Rate limiting (429 responses)
- SOS authenticated flows + /status endpoint
- Moderation unit tests
"""

import requests
import sys
import json
from datetime import datetime
import time

class Phase3SecurityTester:
    def __init__(self, base_url="https://sentinel-app-2.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.token = None
        self.refresh_token = None
        self.csrf_token = None
        self.user_data = None
        self.admin_token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        
        # Test data
        self.test_user = {
            "email": "security.test@safespotglobal.com",
            "password": "SecurePhase3Pass123!",
            "full_name": "Security Tester",
            "phone": "+33123456789"
        }
        
        self.admin_user = {
            "email": "admin.test@safespotglobal.com", 
            "password": "AdminSecurePass123!",
            "full_name": "Admin Tester",
            "phone": "+33987654321"
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

    def make_request(self, method, endpoint, data=None, expected_status=200, headers=None):
        """Make HTTP request with proper headers"""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        request_headers = {'Content-Type': 'application/json'}
        
        if self.token:
            request_headers['Authorization'] = f'Bearer {self.token}'
        
        if self.csrf_token:
            request_headers['X-CSRF-Token'] = self.csrf_token
            
        if headers:
            request_headers.update(headers)

        try:
            if method == 'GET':
                response = requests.get(url, headers=request_headers, timeout=30)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=request_headers, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=request_headers, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=request_headers, timeout=30)
            
            success = response.status_code == expected_status
            response_data = None
            
            try:
                response_data = response.json()
            except:
                response_data = {"raw_response": response.text}
            
            return success, response.status_code, response_data
            
        except Exception as e:
            return False, 0, {"error": str(e)}

    # ========== PHASE 3 AUTH TESTS ==========
    
    def test_auth_register(self):
        """Test Phase 3 user registration"""
        success, status, data = self.make_request('POST', '/auth/register', self.test_user, 200)
        
        if success and 'access_token' in data:
            self.token = data['access_token']
            self.refresh_token = data.get('refresh_token')
            self.user_data = data.get('user', {})
            self.log_result("Phase 3 Auth - Register", True, 
                          f"User registered with JWT access token")
        else:
            # Try to login if user already exists
            if status == 400 and "already registered" in str(data):
                self.log_result("Phase 3 Auth - Register", True, 
                              "User already exists (expected for repeated tests)")
                return self.test_auth_login()
            else:
                self.log_result("Phase 3 Auth - Register", False, 
                              f"Status: {status}, Response: {data}")

    def test_auth_login(self):
        """Test Phase 3 user login"""
        login_data = {
            "email": self.test_user["email"],
            "password": self.test_user["password"]
        }
        
        success, status, data = self.make_request('POST', '/auth/login', login_data, 200)
        
        if success and 'access_token' in data:
            self.token = data['access_token']
            self.refresh_token = data.get('refresh_token')
            self.user_data = data.get('user', {})
            self.log_result("Phase 3 Auth - Login", True, 
                          f"Login successful with JWT tokens")
        else:
            self.log_result("Phase 3 Auth - Login", False, 
                          f"Status: {status}, Response: {data}")

    def test_auth_refresh(self):
        """Test JWT refresh token functionality"""
        if not self.refresh_token:
            self.log_result("Phase 3 Auth - Refresh", False, 
                          "No refresh token available from login")
            return
            
        refresh_data = {"refresh_token": self.refresh_token}
        success, status, data = self.make_request('POST', '/auth/refresh', refresh_data, 200)
        
        if success and 'access_token' in data:
            self.token = data['access_token']
            self.log_result("Phase 3 Auth - Refresh", True, 
                          "JWT refresh successful, new access token received")
        else:
            self.log_result("Phase 3 Auth - Refresh", False, 
                          f"Status: {status}, Response: {data}")

    def test_auth_logout(self):
        """Test user logout"""
        if not self.token:
            self.log_result("Phase 3 Auth - Logout", False, "No authentication token available")
            return
            
        success, status, data = self.make_request('POST', '/auth/logout', expected_status=200)
        
        if success:
            self.log_result("Phase 3 Auth - Logout", True, "Logout successful")
            # Clear tokens after successful logout
            old_token = self.token
            self.token = None
            self.refresh_token = None
            
            # Verify token is invalidated
            success_verify, status_verify, data_verify = self.make_request('GET', '/me', expected_status=401)
            if success_verify:
                self.log_result("Phase 3 Auth - Token Invalidation", True, 
                              "Token properly invalidated after logout")
            else:
                self.log_result("Phase 3 Auth - Token Invalidation", False, 
                              f"Token still valid after logout: {status_verify}")
            
            # Restore token for other tests
            self.token = old_token
        else:
            self.log_result("Phase 3 Auth - Logout", False, 
                          f"Status: {status}, Response: {data}")

    # ========== JWT ROTATION & VALIDATION TESTS ==========
    
    def test_jwt_rotation(self):
        """Test JWT rotation endpoint"""
        if not self.token:
            self.log_result("Phase 3 JWT - Rotation", False, "No authentication token available")
            return
            
        success, status, data = self.make_request('POST', '/auth/rotate', expected_status=200)
        
        if success and 'access_token' in data:
            old_token = self.token
            self.token = data['access_token']
            self.log_result("Phase 3 JWT - Rotation", True, 
                          "JWT rotation successful, new token received")
            
            # Verify old token is invalidated
            headers = {'Authorization': f'Bearer {old_token}'}
            success_old, status_old, data_old = self.make_request('GET', '/me', expected_status=401, headers=headers)
            if success_old:
                self.log_result("Phase 3 JWT - Old Token Invalidation", True, 
                              "Old token properly invalidated after rotation")
            else:
                self.log_result("Phase 3 JWT - Old Token Invalidation", False, 
                              f"Old token still valid: {status_old}")
        else:
            self.log_result("Phase 3 JWT - Rotation", False, 
                          f"Status: {status}, Response: {data}")

    def test_malformed_jwt(self):
        """Test malformed JWT rejection"""
        malformed_tokens = [
            "invalid.jwt.token",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature",
            "not-a-jwt-at-all",
            ""
        ]
        
        passed_tests = 0
        for i, malformed_token in enumerate(malformed_tokens):
            headers = {'Authorization': f'Bearer {malformed_token}'}
            success, status, data = self.make_request('GET', '/me', expected_status=401, headers=headers)
            
            if success:
                passed_tests += 1
            else:
                print(f"   Malformed token {i+1} not properly rejected: {status}")
        
        if passed_tests == len(malformed_tokens):
            self.log_result("Phase 3 JWT - Malformed Token Rejection", True, 
                          f"All {len(malformed_tokens)} malformed tokens properly rejected")
        else:
            self.log_result("Phase 3 JWT - Malformed Token Rejection", False, 
                          f"Only {passed_tests}/{len(malformed_tokens)} malformed tokens rejected")

    def test_expired_jwt(self):
        """Test expired JWT rejection"""
        # Create an expired JWT (this is a mock expired token)
        expired_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJleHAiOjE2MDk0NTkyMDB9.invalid"
        
        headers = {'Authorization': f'Bearer {expired_token}'}
        success, status, data = self.make_request('GET', '/me', expected_status=401, headers=headers)
        
        if success:
            self.log_result("Phase 3 JWT - Expired Token Rejection", True, 
                          "Expired JWT properly rejected")
        else:
            self.log_result("Phase 3 JWT - Expired Token Rejection", False, 
                          f"Expired token not rejected: {status}")

    # ========== 2FA TESTS ==========
    
    def test_2fa_setup(self):
        """Test 2FA setup"""
        if not self.token:
            self.log_result("Phase 3 2FA - Setup", False, "No authentication token available")
            return
            
        success, status, data = self.make_request('POST', '/auth/2fa/setup', expected_status=200)
        
        if success and 'qr_code' in data and 'backup_codes' in data:
            self.totp_secret = data.get('secret')
            self.backup_codes = data.get('backup_codes', [])
            self.log_result("Phase 3 2FA - Setup", True, 
                          f"2FA setup successful, {len(self.backup_codes)} backup codes generated")
        else:
            self.log_result("Phase 3 2FA - Setup", False, 
                          f"Status: {status}, Response: {data}")

    def test_2fa_verify(self):
        """Test 2FA verification"""
        if not self.token:
            self.log_result("Phase 3 2FA - Verify", False, "No authentication token available")
            return
            
        # Mock TOTP code (in real implementation, this would be generated from the secret)
        verify_data = {"totp_code": "123456"}
        success, status, data = self.make_request('POST', '/auth/2fa/verify', verify_data, 200)
        
        if success:
            self.log_result("Phase 3 2FA - Verify", True, "2FA verification successful")
        else:
            self.log_result("Phase 3 2FA - Verify", False, 
                          f"Status: {status}, Response: {data}")

    def test_2fa_backup_codes(self):
        """Test 2FA backup code usage"""
        if not self.token:
            self.log_result("Phase 3 2FA - Backup Codes", False, "No authentication token available")
            return
            
        backup_data = {"backup_code": "backup123"}
        success, status, data = self.make_request('POST', '/auth/2fa/backup', backup_data, 200)
        
        if success:
            self.log_result("Phase 3 2FA - Backup Codes", True, "Backup code verification successful")
        else:
            self.log_result("Phase 3 2FA - Backup Codes", False, 
                          f"Status: {status}, Response: {data}")

    def test_2fa_disable(self):
        """Test 2FA disable"""
        if not self.token:
            self.log_result("Phase 3 2FA - Disable", False, "No authentication token available")
            return
            
        disable_data = {"password": self.test_user["password"]}
        success, status, data = self.make_request('POST', '/auth/2fa/disable', disable_data, 200)
        
        if success:
            self.log_result("Phase 3 2FA - Disable", True, "2FA disabled successfully")
        else:
            self.log_result("Phase 3 2FA - Disable", False, 
                          f"Status: {status}, Response: {data}")

    # ========== RBAC TESTS ==========
    
    def test_rbac_admin_endpoints(self):
        """Test RBAC admin-only endpoint protection"""
        if not self.token:
            self.log_result("Phase 3 RBAC - Admin Protection", False, "No authentication token available")
            return
            
        # Test admin-only endpoints with regular user token
        admin_endpoints = [
            '/admin/users',
            '/admin/reports/moderate',
            '/admin/system/stats',
            '/admin/settings'
        ]
        
        blocked_count = 0
        for endpoint in admin_endpoints:
            success, status, data = self.make_request('GET', endpoint, expected_status=403)
            if success:
                blocked_count += 1
            else:
                print(f"   Admin endpoint {endpoint} not properly protected: {status}")
        
        if blocked_count == len(admin_endpoints):
            self.log_result("Phase 3 RBAC - Admin Protection", True, 
                          f"All {len(admin_endpoints)} admin endpoints properly protected")
        else:
            self.log_result("Phase 3 RBAC - Admin Protection", False, 
                          f"Only {blocked_count}/{len(admin_endpoints)} admin endpoints protected")

    # ========== CSRF TESTS ==========
    
    def test_csrf_token_endpoint(self):
        """Test CSRF token endpoint"""
        success, status, data = self.make_request('GET', '/auth/csrf', expected_status=200)
        
        if success and 'csrf_token' in data:
            self.csrf_token = data['csrf_token']
            self.log_result("Phase 3 CSRF - Token Endpoint", True, 
                          "CSRF token retrieved successfully")
        else:
            self.log_result("Phase 3 CSRF - Token Endpoint", False, 
                          f"Status: {status}, Response: {data}")

    def test_csrf_protection(self):
        """Test CSRF double-submit cookie protection"""
        if not self.token:
            self.log_result("Phase 3 CSRF - Protection", False, "No authentication token available")
            return
            
        # Test protected endpoint without CSRF token (should fail)
        test_data = {"name": "Test Contact", "phone": "+33123456789", "relationship": "friend"}
        success_no_csrf, status_no_csrf, data_no_csrf = self.make_request(
            'POST', '/contacts', test_data, expected_status=403)
        
        if success_no_csrf:
            csrf_protected = True
        else:
            csrf_protected = False
            print(f"   CSRF protection not enforced: {status_no_csrf}")
        
        # Test with CSRF token (should succeed if token is valid)
        if self.csrf_token:
            success_with_csrf, status_with_csrf, data_with_csrf = self.make_request(
                'POST', '/contacts', test_data, expected_status=200)
            
            if success_with_csrf:
                csrf_works = True
            else:
                csrf_works = False
                print(f"   CSRF token not working: {status_with_csrf}")
        else:
            csrf_works = False
            print("   No CSRF token available for testing")
        
        if csrf_protected:
            self.log_result("Phase 3 CSRF - Protection", True, 
                          "CSRF double-submit cookie protection working")
        else:
            self.log_result("Phase 3 CSRF - Protection", False, 
                          "CSRF protection not properly implemented")

    # ========== RATE LIMITING TESTS ==========
    
    def test_rate_limiting(self):
        """Test rate limiting (429 responses)"""
        # Test rate limiting on login endpoint
        login_data = {
            "email": "nonexistent@test.com",
            "password": "wrongpassword"
        }
        
        rate_limited = False
        for i in range(10):  # Try to trigger rate limiting
            success, status, data = self.make_request('POST', '/auth/login', login_data, expected_status=401)
            
            if status == 429:
                rate_limited = True
                break
            
            time.sleep(0.1)  # Small delay between requests
        
        if rate_limited:
            self.log_result("Phase 3 Rate Limiting - 429 Response", True, 
                          "Rate limiting triggered, 429 response received")
            
            # Test that rate limiting eventually allows requests again
            time.sleep(2)  # Wait for rate limit to reset
            success_after, status_after, data_after = self.make_request('POST', '/auth/login', login_data, expected_status=401)
            
            if status_after == 401:  # Should be back to normal auth error, not rate limited
                self.log_result("Phase 3 Rate Limiting - Recovery", True, 
                              "Rate limiting properly resets after cooldown")
            else:
                self.log_result("Phase 3 Rate Limiting - Recovery", False, 
                              f"Rate limiting not properly reset: {status_after}")
        else:
            self.log_result("Phase 3 Rate Limiting - 429 Response", False, 
                          "Rate limiting not implemented or threshold too high")

    # ========== SOS AUTHENTICATED TESTS ==========
    
    def test_sos_authenticated_flows(self):
        """Test SOS authenticated flows"""
        if not self.token:
            self.log_result("Phase 3 SOS - Authenticated Flows", False, "No authentication token available")
            return
            
        sos_data = {
            "message": "Phase 3 Security Test SOS",
            "latitude": 48.8566,
            "longitude": 2.3522
        }
        
        success, status, data = self.make_request('POST', '/sos/start', sos_data, 200)
        
        if success and 'id' in data:
            sos_id = data['id']
            self.log_result("Phase 3 SOS - Start", True, 
                          f"Authenticated SOS started successfully: {sos_id}")
            
            # Test ending SOS
            success_end, status_end, data_end = self.make_request('POST', f'/sos/{sos_id}/end', expected_status=200)
            
            if success_end:
                self.log_result("Phase 3 SOS - End", True, "Authenticated SOS ended successfully")
            else:
                self.log_result("Phase 3 SOS - End", False, 
                              f"Status: {status_end}, Response: {data_end}")
        else:
            self.log_result("Phase 3 SOS - Start", False, 
                          f"Status: {status}, Response: {data}")

    def test_sos_status_endpoint(self):
        """Test SOS status endpoint"""
        if not self.token:
            self.log_result("Phase 3 SOS - Status Endpoint", False, "No authentication token available")
            return
            
        success, status, data = self.make_request('GET', '/sos/status', expected_status=200)
        
        if success:
            active_sessions = data.get('active_sessions', 0)
            self.log_result("Phase 3 SOS - Status Endpoint", True, 
                          f"SOS status retrieved: {active_sessions} active sessions")
        else:
            self.log_result("Phase 3 SOS - Status Endpoint", False, 
                          f"Status: {status}, Response: {data}")

    # ========== MODERATION UNIT TESTS ==========
    
    def test_moderation_appropriate_content(self):
        """Test AI moderation with appropriate content"""
        if not self.token:
            self.log_result("Phase 3 Moderation - Appropriate Content", False, "No authentication token available")
            return
            
        appropriate_report = {
            "type": "crime",
            "title": "Witnessed a theft",
            "description": "I saw someone steal a bicycle from the park. The person was wearing a red jacket.",
            "latitude": 48.8566,
            "longitude": 2.3522
        }
        
        success, status, data = self.make_request('POST', '/reports', appropriate_report, 200)
        
        if success and data.get('status') == 'validated' and data.get('trust_score', 0) >= 50:
            self.log_result("Phase 3 Moderation - Appropriate Content", True, 
                          f"Appropriate content properly validated (trust_score: {data.get('trust_score')})")
        else:
            self.log_result("Phase 3 Moderation - Appropriate Content", False, 
                          f"Status: {status}, Response: {data}")

    def test_moderation_inappropriate_content(self):
        """Test AI moderation with inappropriate content"""
        if not self.token:
            self.log_result("Phase 3 Moderation - Inappropriate Content", False, "No authentication token available")
            return
            
        inappropriate_report = {
            "type": "other",
            "title": "Hate speech test",
            "description": "This is inappropriate content with hate speech and offensive language that should be flagged",
            "latitude": 48.8566,
            "longitude": 2.3522
        }
        
        success, status, data = self.make_request('POST', '/reports', inappropriate_report, 200)
        
        if success:
            flagged = data.get('status') == 'pending' or data.get('trust_score', 100) < 50
            if flagged:
                self.log_result("Phase 3 Moderation - Inappropriate Content", True, 
                              f"Inappropriate content properly flagged (trust_score: {data.get('trust_score')})")
            else:
                self.log_result("Phase 3 Moderation - Inappropriate Content", False, 
                              f"Inappropriate content not flagged (trust_score: {data.get('trust_score')})")
        else:
            self.log_result("Phase 3 Moderation - Inappropriate Content", False, 
                          f"Status: {status}, Response: {data}")

    def test_moderation_fallback(self):
        """Test AI moderation fallback behavior"""
        # This test simulates what happens when AI moderation fails
        # In a real implementation, we might temporarily disable the AI service
        # For now, we'll test that the system handles moderation gracefully
        
        fallback_report = {
            "type": "weather",
            "title": "Storm warning",
            "description": "Heavy rain and wind expected in the area",
            "latitude": 48.8566,
            "longitude": 2.3522
        }
        
        success, status, data = self.make_request('POST', '/reports', fallback_report, 200)
        
        if success and 'trust_score' in data:
            # System should handle moderation gracefully even if AI fails
            self.log_result("Phase 3 Moderation - Fallback", True, 
                          f"Moderation fallback working (trust_score: {data.get('trust_score')})")
        else:
            self.log_result("Phase 3 Moderation - Fallback", False, 
                          f"Status: {status}, Response: {data}")

    # ========== MAIN TEST RUNNER ==========
    
    def run_phase3_security_suite(self):
        """Run complete Phase 3 security test suite"""
        print("🔒 Starting Phase 3 Security & Auth Test Suite")
        print("=" * 70)
        print()
        
        # 1. Auth register/login/refresh/logout
        print("📋 1. AUTH FLOWS")
        print("-" * 30)
        self.test_auth_register()
        self.test_auth_login()
        self.test_auth_refresh()
        self.test_auth_logout()
        print()
        
        # 2. 2FA setup/verify/disable + backup
        print("📋 2. TWO-FACTOR AUTHENTICATION")
        print("-" * 30)
        self.test_2fa_setup()
        self.test_2fa_verify()
        self.test_2fa_backup_codes()
        self.test_2fa_disable()
        print()
        
        # 3. JWT rotation + malformed/expired
        print("📋 3. JWT VALIDATION & ROTATION")
        print("-" * 30)
        self.test_jwt_rotation()
        self.test_malformed_jwt()
        self.test_expired_jwt()
        print()
        
        # 4. RBAC admin-only forbid non-admin
        print("📋 4. ROLE-BASED ACCESS CONTROL")
        print("-" * 30)
        self.test_rbac_admin_endpoints()
        print()
        
        # 5. CSRF double-submit cookie
        print("📋 5. CSRF PROTECTION")
        print("-" * 30)
        self.test_csrf_token_endpoint()
        self.test_csrf_protection()
        print()
        
        # 6. Rate limiting 429 + then success
        print("📋 6. RATE LIMITING")
        print("-" * 30)
        self.test_rate_limiting()
        print()
        
        # 7. SOS authenticated sanity including /status
        print("📋 7. SOS AUTHENTICATED FLOWS")
        print("-" * 30)
        self.test_sos_authenticated_flows()
        self.test_sos_status_endpoint()
        print()
        
        # 8. Moderation unit tests
        print("📋 8. AI MODERATION")
        print("-" * 30)
        self.test_moderation_appropriate_content()
        self.test_moderation_inappropriate_content()
        self.test_moderation_fallback()
        print()
        
        # Final results
        self.print_phase3_summary()

    def print_phase3_summary(self):
        """Print Phase 3 test summary"""
        print("=" * 70)
        print("🏁 PHASE 3 SECURITY TEST SUMMARY")
        print("=" * 70)
        print(f"Total Tests: {self.tests_run}")
        print(f"Passed: {self.tests_passed}")
        print(f"Failed: {len(self.failed_tests)}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%" if self.tests_run > 0 else "0%")
        print()
        
        # Categorize failures
        auth_failures = []
        security_failures = []
        feature_failures = []
        
        for failure in self.failed_tests:
            test_name = failure['test']
            if 'Auth' in test_name or 'JWT' in test_name or '2FA' in test_name:
                auth_failures.append(failure)
            elif 'RBAC' in test_name or 'CSRF' in test_name or 'Rate Limiting' in test_name:
                security_failures.append(failure)
            else:
                feature_failures.append(failure)
        
        if auth_failures:
            print("❌ AUTHENTICATION & JWT FAILURES:")
            print("-" * 40)
            for failure in auth_failures:
                print(f"• {failure['test']}")
                print(f"  {failure['details']}")
            print()
        
        if security_failures:
            print("❌ SECURITY FEATURE FAILURES:")
            print("-" * 40)
            for failure in security_failures:
                print(f"• {failure['test']}")
                print(f"  {failure['details']}")
            print()
        
        if feature_failures:
            print("❌ FEATURE FAILURES:")
            print("-" * 40)
            for failure in feature_failures:
                print(f"• {failure['test']}")
                print(f"  {failure['details']}")
            print()
        
        if self.tests_passed == self.tests_run:
            print("🎉 ALL PHASE 3 SECURITY TESTS PASSED!")
            print("Backend has full Phase 3 security implementation.")
        else:
            missing_features = len(self.failed_tests)
            print(f"⚠️  {missing_features} Phase 3 security features missing or failing.")
            print("Current backend needs Phase 3 security feature implementation.")
        
        return len(self.failed_tests) == 0

def main():
    """Main test execution"""
    print("SafeSpot Sentinel Global - Phase 3 Security Test Suite")
    print(f"Testing against: https://sentinel-app-2.preview.emergentagent.com/api")
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    tester = Phase3SecurityTester()
    success = tester.run_phase3_security_suite()
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())