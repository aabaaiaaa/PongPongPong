# Hosting 4-Player Pong in IIS

This guide will help you host your game in IIS (Internet Information Services) on Windows.

## Prerequisites

### 1. Install IIS
1. Open **Control Panel** → **Programs** → **Turn Windows features on or off**
2. Check these boxes:
   - **Internet Information Services**
   - Under IIS → World Wide Web Services → Application Development Features:
     - **WebSocket Protocol** (IMPORTANT for the game to work!)
   - Under IIS → Web Management Tools:
     - **IIS Management Console**
3. Click OK and wait for installation

### 2. Install URL Rewrite Module
1. Download from: https://www.iis.net/downloads/microsoft/url-rewrite
2. Run the installer
3. Restart IIS Manager after installation

### 3. Install iisnode
1. Download from: https://github.com/azure/iisnode/releases
2. Choose the correct version:
   - **iisnode-full-v0.2.26-x64.msi** (for 64-bit Windows)
   - **iisnode-full-v0.2.26-x86.msi** (for 32-bit Windows)
3. Run the installer
4. Restart your computer

### 4. Verify Node.js Installation
1. Open Command Prompt
2. Run: `node --version`
3. Make sure Node.js is installed and accessible

## IIS Configuration

### Step 1: Create a New Website in IIS

1. Open **IIS Manager** (search for "IIS" in Start menu)

2. In the left panel, expand your computer name, right-click on **Sites**

3. Select **Add Website**

4. Fill in the details:
   - **Site name:** 4PlayerPong
   - **Physical path:** Browse to `C:\Users\jeastaugh\source\repos\Experiments\PongPongPong`
   - **Binding:**
     - Type: http
     - IP address: All Unassigned
     - Port: 80 (or choose another port like 8080 if port 80 is in use)
     - Host name: (leave empty or use localhost)

5. Click **OK**

### Step 2: Configure Application Pool

1. In IIS Manager, click on **Application Pools** in the left panel

2. Find the application pool for your site (usually same name as the site)

3. Right-click on it and select **Basic Settings**

4. Set:
   - **.NET CLR version:** No Managed Code
   - **Managed pipeline mode:** Integrated

5. Click **OK**

6. Right-click the application pool again and select **Advanced Settings**

7. Under **Process Model**, set:
   - **Identity:** ApplicationPoolIdentity or NetworkService

8. Click **OK**

### Step 3: Set Permissions

1. Open File Explorer and navigate to your project folder:
   `C:\Users\jeastaugh\source\repos\Experiments\PongPongPong`

2. Right-click the folder → **Properties** → **Security** tab

3. Click **Edit** → **Add**

4. Type **IIS_IUSRS** and click **Check Names** → **OK**

5. Give **IIS_IUSRS** these permissions:
   - Read & Execute
   - List folder contents
   - Read

6. Click **Apply** → **OK**

### Step 4: Start the Website

1. In IIS Manager, right-click your website in the left panel

2. Select **Manage Website** → **Start**

3. The website should now be running!

## Accessing Your Game

### Local Access:
- http://localhost (or http://localhost:8080 if you used port 8080)

### Network Access:
1. Find your computer's IP address:
   - Open Command Prompt
   - Run: `ipconfig`
   - Look for "IPv4 Address" under your active network adapter (usually starts with 192.168.x.x)

2. On other devices on your network, browse to:
   - http://YOUR_IP_ADDRESS (example: http://192.168.1.171)
   - Or http://YOUR_IP_ADDRESS:8080 if using port 8080

### Configure Windows Firewall:
If other devices can't connect, add a firewall rule:
1. Run `allow-firewall.bat` as Administrator (or manually allow port 80/8080)

## Troubleshooting

### Problem: Website won't start
- Check the Application Pool is running
- Check that no other service is using the port
- Review IIS logs at: `C:\inetpub\logs\LogFiles`

### Problem: 500.x errors
- Check that iisnode is installed correctly
- Verify Node.js is in the system PATH
- Check file permissions for IIS_IUSRS
- Review logs at: `C:\Users\jeastaugh\source\repos\Experiments\PongPongPong\iisnode`

### Problem: WebSocket not working
- Make sure WebSocket Protocol is installed in IIS
- Verify web.config has `<webSocket enabled="true" />`
- Check that your firewall allows WebSocket connections

### Problem: Can't find the page
- Verify the physical path is correct in IIS
- Check that all files are in the folder
- Make sure URL Rewrite module is installed

## Logs

If something goes wrong, check these logs:
- IIS logs: `C:\inetpub\logs\LogFiles`
- iisnode logs: `C:\Users\jeastaugh\source\repos\Experiments\PongPongPong\iisnode`
- Application logs: Windows Event Viewer → Application

## Notes

- The web.config file has been created for you
- Node.js will run as a background process managed by IIS
- IIS will automatically restart the Node.js process if it crashes
- The game supports WebSocket connections for real-time multiplayer
