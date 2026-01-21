# SAP BTP Connectivity Setup Guide

## Overview
This guide explains how to configure your application to connect to internal APIs (like `ews-emea.api.bosch.com`) when deployed on SAP BTP using SAP Cloud Connector.

---

## Architecture

```
SAP BTP (Cloud)
    ↓
[Your Python App]
    ↓
[Connectivity Service] → [Cloud Connector] → Internal Network
    ↓                                              ↓
[Destination Service]                    [ews-emea.api.bosch.com]
```

---

## Prerequisites

- SAP BTP account with Cloud Foundry environment
- Admin access to SAP BTP Cockpit
- Server in corporate network (for Cloud Connector)
- Access to internal APIs from that server

---

## Phase 1: SAP Cloud Connector Setup (On-Premise)

### 1.1 Install Cloud Connector

1. **Download** Cloud Connector from [SAP Support Portal](https://tools.hana.ondemand.com/#cloud)
2. **Install** on a server that can reach `ews-emea.api.bosch.com`
3. **Start** Cloud Connector service

### 1.2 Configure Cloud Connector

1. **Access UI**: `https://localhost:8443` (default credentials: Administrator/manage)

2. **Add Subaccount**:
   - Region: Your BTP region (e.g., cf-eu10)
   - Subaccount ID: Copy from BTP Cockpit → Overview
   - Display Name: Your app name
   - Login Email: Your BTP user
   - Password: Your BTP password
   - Location ID: (leave empty or use custom ID)

3. **Add Access Control**:
   - Go to: Cloud To On-Premise → Access Control
   - Click: "+" to add mapping
   
   **Backend Type**: `Non-SAP System`
   
   **Protocol**: `HTTPS`
   
   **Internal Host**: `ews-emea.api.bosch.com`
   
   **Internal Port**: `443`
   
   **Virtual Host**: `ews-emea.api.bosch.com` (keep same)
   
   **Virtual Port**: `443`
   
   **Principal Type**: `None` (or configure if needed)
   
   **Check Internal Host**: ✅ Enabled

4. **Add Resources (URL Paths)**:
   - Click on the mapping you just created
   - Add resources:
     ```
     URL Path: /it/application/dia-brain
     Access Policy: Path and all sub-paths
     ```

5. **Verify Status**: Should show "Connected" in green

---

## Phase 2: SAP BTP Configuration

### 2.1 Create Service Instances

In BTP Cockpit → Your Space → Services → Service Marketplace:

#### A. Create Connectivity Service
```bash
cf create-service connectivity lite my-connectivity
```

#### B. Create Destination Service
```bash
cf create-service destination lite my-destination
```

### 2.2 Create Destination

1. Go to: BTP Cockpit → Connectivity → Destinations
2. Click: "New Destination"
3. Configure:

```properties
Name: BRAIN_API
Type: HTTP
Description: Brain API via Cloud Connector
URL: https://ews-emea.api.bosch.com:443
Proxy Type: OnPremise
Authentication: NoAuthentication

# Additional Properties (click "New Property"):
HTML5.DynamicDestination: true
WebIDEEnabled: true
WebIDEUsage: odata_gen
```

4. Click: "Check Connection" to verify
5. Save

---

## Phase 3: Application Deployment

### 3.1 Create/Update manifest.yml

Create `manifest.yml` in your project root:

```yaml
---
applications:
  - name: dscp-ai
    memory: 512M
    instances: 1
    buildpack: python_buildpack
    command: python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
    services:
      - my-connectivity
      - my-destination
    env:
      BRAIN_TENANT_ID: "your-tenant-id"
      BRAIN_CLIENT_ID: "your-client-id"
      BRAIN_CLIENT_SECRET: "your-client-secret"
      SIGNAVIO_BRAIN_ID: "your-signavio-brain-id"
      AUDIT_CHECK_BRAIN_ID: "your-audit-brain-id"
      USE_SAP_CONNECTIVITY: "true"
      DESTINATION_NAME: "BRAIN_API"
```

### 3.2 Deploy Application

```bash
# Login to Cloud Foundry
cf login -a https://api.cf.eu10.hana.ondemand.com

# Target your org and space
cf target -o "your-org" -s "your-space"

# Push application
cf push
```

### 3.3 Bind Services (if not in manifest)

```bash
cf bind-service dscp-ai my-connectivity
cf bind-service dscp-ai my-destination
cf restage dscp-ai
```

---

## Phase 4: Local Testing (Optional)

### 4.1 Test WITHOUT SAP Connectivity (Local Dev)

Create `.env` file:
```env
USE_SAP_CONNECTIVITY=false
BRAIN_API_BASE_URL=https://ews-emea.api.bosch.com:443/it/application/dia-brain/v1/api
BRAIN_TENANT_ID=your-tenant-id
BRAIN_CLIENT_ID=your-client-id
BRAIN_CLIENT_SECRET=your-client-secret
SIGNAVIO_BRAIN_ID=your-brain-id
AUDIT_CHECK_BRAIN_ID=your-brain-id
DESTINATION_NAME=BRAIN_API
```

Run:
```bash
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

### 4.2 Test WITH SAP Connectivity (Simulated BTP)

This requires VCAP_SERVICES environment variable with service credentials. Not recommended for local testing.

---

## Verification & Troubleshooting

### Check Cloud Connector Status
1. Open Cloud Connector UI
2. Go to: Cloud To On-Premise → Access Control
3. Verify: Status is "Connected" (green)
4. Check: "Requests" counter should increase when app makes calls

### Check BTP Logs
```bash
cf logs dscp-ai --recent
```

Look for:
- ✅ `SAP Connectivity initialized`
- ❌ `Could not initialize SAP services`
- ❌ `Error getting connectivity proxy`

### Test Destination
In BTP Cockpit:
1. Go to: Connectivity → Destinations → BRAIN_API
2. Click: "Check Connection"
3. Should return: Success

### Common Issues

**Issue**: "Error getting connectivity token"
- **Fix**: Verify connectivity service is bound: `cf services`

**Issue**: "Destination not found"
- **Fix**: Check destination name matches `DESTINATION_NAME` in env

**Issue**: "Connection refused"
- **Fix**: Verify Cloud Connector is running and connected

**Issue**: "403 Forbidden"
- **Fix**: Check URL path is allowed in Cloud Connector resources

**Issue**: "Connection timeout"
- **Fix**: Verify internal host is reachable from Cloud Connector server

---

## Code Changes Summary

### What Was Changed:

1. **requirements.txt**: Added `cfenv`, `sap-xssec`, `requests`

2. **sap_connectivity_service.py** (NEW): 
   - Handles SAP connectivity and destination services
   - Manages proxy configuration
   - Gets connectivity tokens

3. **config.py**: 
   - Added `USE_SAP_CONNECTIVITY` flag
   - Added `DESTINATION_NAME` configuration
   - Added `BRAIN_API_BASE_URL` default

4. **brain_auth.py**: 
   - Updated to use SAP proxy when enabled
   - Routes OAuth through Cloud Connector if needed

5. **common_service.py**: 
   - All API calls now support SAP connectivity
   - Automatic proxy and header injection
   - Destination-based URL resolution

### How It Works:

- **Local (USE_SAP_CONNECTIVITY=false)**:
  - Direct API calls to `BRAIN_API_BASE_URL`
  - No proxy, no Cloud Connector
  
- **BTP (USE_SAP_CONNECTIVITY=true)**:
  - Reads destination from BTP
  - Uses Cloud Connector proxy
  - Adds SAP authentication headers
  - Routes through internal network

---

## Next Steps

1. ✅ Install & configure Cloud Connector
2. ✅ Create BTP service instances
3. ✅ Configure destination
4. ✅ Update manifest.yml with your credentials
5. ✅ Deploy to BTP: `cf push`
6. ✅ Test your application
7. ✅ Monitor Cloud Connector requests

---

## Support & References

- [SAP Cloud Connector Documentation](https://help.sap.com/docs/CP_CONNECTIVITY/cca91383641e40ffbe03bdc78f00f681/e6c7616abb5710148cfcf3e75d96d596.html)
- [SAP Destination Service](https://help.sap.com/docs/CP_CONNECTIVITY/cca91383641e40ffbe03bdc78f00f681/7e306250e08340f89d6c103e28840f30.html)
- [Cloud Foundry Python Buildpack](https://docs.cloudfoundry.org/buildpacks/python/)

---

## Quick Reference

### Check Service Bindings
```bash
cf env dscp-ai
```

### Restart App
```bash
cf restart dscp-ai
```

### View App Routes
```bash
cf routes
```

### Scale App
```bash
cf scale dscp-ai -i 2 -m 1G
```
