const net = require('node:net');

class RawTcpTransport {
  constructor(options) {
    this.host = options.host;
    this.port = options.port;
  }

  async send(payload, timeoutMs = 10_000) {
    if (!this.host) {
      throw new Error('Printer host is required for raw_tcp transport');
    }

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: this.host,
        port: this.port
      });

      const onError = (error) => {
        socket.destroy();
        reject(error);
      };

      socket.setTimeout(timeoutMs, () => {
        onError(new Error(`Printer socket timed out after ${timeoutMs}ms`));
      });

      socket.once('error', onError);

      socket.once('connect', () => {
        socket.write(payload, (error) => {
          if (error) {
            onError(error);
            return;
          }

          socket.end();
        });
      });

      socket.once('close', (hadError) => {
        if (!hadError) {
          resolve({ bytesSent: payload.length });
        }
      });
    });
  }
}

module.exports = RawTcpTransport;
