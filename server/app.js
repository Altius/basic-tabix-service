#!/usr/bin/env node

const express = require('express');
const request = require('request');
const https = require('https');
const fs = require('fs');
const debug = require('debug')('tabix-service:server');
const normalizePort = require('normalize-port');
const nocache = require('nocache');
const morgan = require('morgan');
const cp = require('child_process');
const spawn = cp.spawn;

const app = module.exports = express();

/**
 * Listen
 */
 
const defaultPort = 9003;

let port = normalizePort(process.env.PORT || defaultPort);
app.set('port', port);

let byteLimit = (process.env.BYTELIMIT || 1024*1024);
// let lineLimit = (process.env.LINELIMIT || 100);

let privateKeyFn = (process.env.SSLPRIVATEKEY || '/etc/ssl/private/altius.org.key');
let certificateFn = (process.env.SSLCERTIFICATE || '/etc/ssl/certs/altius-bundle.crt');

let privateKey = fs.readFileSync(privateKeyFn);
let certificate = fs.readFileSync(certificateFn);

const options = {
  key: privateKey,
  cert: certificate
};

let server = https.createServer(options, app);
server.listen(port);
server.on('error', onError);
server.on('listening', onListening);

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  let bind = typeof port === 'string'
    ? 'Pipe ' + port
    : 'Port ' + port;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(bind + ' is already in use');
      process.exit(1);
      break;
    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
  let addr = server.address();
  let bind = typeof addr === 'string'
    ? 'pipe ' + addr
    : 'port ' + addr.port;
  debug('Listening on ' + bind);
}

/**
 * Allow CORS
 */

function cors(req, res, next) {
  res.set('Access-Control-Allow-Origin', req.headers.origin);
  res.set('Access-Control-Allow-Methods', req.method);
  res.set('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type');
  res.set('Access-Control-Allow-Credentials', true);

  // Respond OK if the method is OPTIONS
  if (req.method === 'OPTIONS') {
    return res.send(200);
  } else {
    return next();
  }
}

/**
 * Response, CORS, cache policy and logging
 */

app.use(cors);
app.use(nocache());
app.use(morgan('combined'));

const datasets = {
  SAMPLE : { 'name' : 'sample', 'path' : 'archives/sample.bed.gz' }
};

app.get('/favicon.ico', (req, res) => {
  res.sendStatus(404);
});

app.get('/', (req, res, next) => {
  let tabixPath = decodeURIComponent(req.query.dataset);
  let tabixRange = decodeURIComponent(req.query.range);
  
  let tabixCmdArgs = [tabixPath, tabixRange];
  let tabixCmd = spawn('/usr/bin/tabix', tabixCmdArgs, { shell: true });
  console.log(tabixCmd.spawnargs.join(' '));
  let tabixData = '';
  tabixCmd.stdout.setEncoding('utf8');
  tabixCmd.stdout.on('data', function(data) { 
    tabixData += data.toString(); 
  });
  tabixCmd.stdout.on('end', function() { 
    res.write(tabixData);
  });
  tabixCmd.on('close', (tabixCmdExitCode) => {
    if (tabixCmdExitCode !== 0) {
      res.status(400).send(`Invalid input or other error (${tabixCmdExitCode})`);
    }
    else {
      req
        .pipe(tabixCmd.stdout)
        .on('response', function(response) {
          let contentLength = req.socket.bytesRead;
          if (contentLength > byteLimit) {
            res.status(400).send("Went over content byte limit");
          }
          // Rewrite content header to force it to text
          response.headers['content-type'] = 'text/plain';
        })
        .pipe(res);
    }
    return;
  });
});