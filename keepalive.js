const express = require('express');
const server = express();

server.all('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Discord Staff Points Bot</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            background: #2c2f33; 
            color: #ffffff; 
            text-align: center; 
            padding: 50px; 
          }
          .status { 
            background: #7289da; 
            padding: 20px; 
            border-radius: 10px; 
            display: inline-block; 
          }
        </style>
      </head>
      <body>
        <div class="status">
          <h1>🤖 Staff Points Bot is Online!</h1>
          <p>Bot Status: Active</p>
          <p>Uptime: ${process.uptime().toFixed(2)} seconds</p>
          <p>Memory Usage: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB</p>
        </div>
      </body>
    </html>
  `);
});

function keepAlive() {
  server.listen(3000, () => {
    console.log('🚀 Keep-alive server is running on port 3000');
  });
}

module.exports = keepAlive;
