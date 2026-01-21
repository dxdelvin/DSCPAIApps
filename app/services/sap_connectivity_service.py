"""
SAP BTP Connectivity Service
Handles connectivity to on-premise systems via SAP Cloud Connector
"""
import os
import json
import httpx
from typing import Optional, Dict, Tuple
from cfenv import AppEnv


class SAPConnectivityService:
    """Manage SAP BTP Connectivity and Destination services."""
    
    def __init__(self):
        self.env = AppEnv()
        self.connectivity_service = None
        self.destination_service = None
        self.use_sap_connectivity = os.getenv("USE_SAP_CONNECTIVITY", "false").lower() == "true"
        
        if self.use_sap_connectivity:
            self._initialize_services()
    
    def _initialize_services(self):
        """Initialize connectivity and destination services from VCAP."""
        try:
            # Get connectivity service credentials
            self.connectivity_service = self.env.get_service(label='connectivity')
            # Get destination service credentials
            self.destination_service = self.env.get_service(label='destination')
        except Exception as e:
            print(f"Warning: Could not initialize SAP services: {e}")
            print("Running without SAP connectivity. Ensure services are bound in BTP.")
    
    def get_connectivity_proxy(self) -> Optional[Dict[str, str]]:
        """Get the SAP Cloud Connector proxy configuration."""
        if not self.use_sap_connectivity or not self.connectivity_service:
            return None
        
        try:
            credentials = self.connectivity_service.credentials
            proxy_host = credentials.get('onpremise_proxy_host')
            proxy_port = credentials.get('onpremise_proxy_http_port', credentials.get('onpremise_proxy_port'))
            
            if proxy_host and proxy_port:
                proxy_url = f"http://{proxy_host}:{proxy_port}"
                return {
                    "http://": proxy_url,
                    "https://": proxy_url
                }
        except Exception as e:
            print(f"Error getting connectivity proxy: {e}")
        
        return None
    
    async def get_connectivity_token(self) -> Optional[str]:
        """Get JWT token for SAP Cloud Connector authentication."""
        if not self.use_sap_connectivity or not self.connectivity_service:
            return None
        
        try:
            credentials = self.connectivity_service.credentials
            token_url = credentials.get('token_service_url')
            client_id = credentials.get('clientid')
            client_secret = credentials.get('clientsecret')
            
            if not all([token_url, client_id, client_secret]):
                print("Missing connectivity service credentials")
                return None
            
            # Request token from SAP UAA
            token_endpoint = f"{token_url}/oauth/token"
            data = {
                'client_id': client_id,
                'client_secret': client_secret,
                'grant_type': 'client_credentials'
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    token_endpoint,
                    data=data,
                    headers={'Content-Type': 'application/x-www-form-urlencoded'}
                )
                response.raise_for_status()
                token_data = response.json()
                return token_data.get('access_token')
                
        except Exception as e:
            print(f"Error getting connectivity token: {e}")
            return None
    
    async def get_destination(self, destination_name: str) -> Optional[Dict]:
        """Retrieve destination configuration from BTP."""
        if not self.use_sap_connectivity or not self.destination_service:
            return None
        
        try:
            credentials = self.destination_service.credentials
            dest_uri = credentials.get('uri')
            token_url = credentials.get('url')
            client_id = credentials.get('clientid')
            client_secret = credentials.get('clientsecret')
            
            if not all([dest_uri, token_url, client_id, client_secret]):
                print("Missing destination service credentials")
                return None
            
            # Get destination service token
            token_endpoint = f"{token_url}/oauth/token"
            token_data = {
                'client_id': client_id,
                'client_secret': client_secret,
                'grant_type': 'client_credentials'
            }
            
            async with httpx.AsyncClient() as client:
                # Get token
                token_response = await client.post(
                    token_endpoint,
                    data=token_data,
                    headers={'Content-Type': 'application/x-www-form-urlencoded'}
                )
                token_response.raise_for_status()
                access_token = token_response.json().get('access_token')
                
                # Get destination configuration
                dest_url = f"{dest_uri}/destination-configuration/v1/destinations/{destination_name}"
                dest_response = await client.get(
                    dest_url,
                    headers={'Authorization': f'Bearer {access_token}'}
                )
                dest_response.raise_for_status()
                
                return dest_response.json()
                
        except Exception as e:
            print(f"Error getting destination '{destination_name}': {e}")
            return None
    
    async def get_proxy_headers(self) -> Dict[str, str]:
        """Get headers required for SAP Cloud Connector proxy authentication."""
        headers = {}
        
        if self.use_sap_connectivity:
            connectivity_token = await self.get_connectivity_token()
            if connectivity_token:
                headers['Proxy-Authorization'] = f'Bearer {connectivity_token}'
                headers['SAP-Connectivity-Authentication'] = f'Bearer {connectivity_token}'
        
        return headers
    
    async def prepare_request_config(self, destination_name: Optional[str] = None) -> Tuple[Optional[str], Optional[Dict], Dict[str, str]]:
        """
        Prepare complete request configuration for API calls.
        
        Returns:
            Tuple of (base_url, proxies, headers)
        """
        if not self.use_sap_connectivity:
            return None, None, {}
        
        # Get destination configuration
        base_url = None
        if destination_name:
            destination = await self.get_destination(destination_name)
            if destination:
                dest_config = destination.get('destinationConfiguration', {})
                base_url = dest_config.get('URL')
        
        # Get proxy configuration
        proxies = self.get_connectivity_proxy()
        
        # Get proxy authentication headers
        proxy_headers = await self.get_proxy_headers()
        
        return base_url, proxies, proxy_headers


# Singleton instance
_sap_connectivity = None


def get_sap_connectivity() -> SAPConnectivityService:
    """Get or create SAP Connectivity Service singleton."""
    global _sap_connectivity
    if _sap_connectivity is None:
        _sap_connectivity = SAPConnectivityService()
    return _sap_connectivity
