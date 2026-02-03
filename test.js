// Simple test file to verify iisnode is working
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>iisnode is working!</h1><p>Node.js version: ' + process.version + '</p>');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Test server running on port:', PORT);
});
