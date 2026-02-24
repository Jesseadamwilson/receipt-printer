class NoopTransport {
  constructor(options = {}) {
    this.reason = options.reason || 'print disabled';
  }

  async send(payload) {
    return {
      bytesSent: payload.length,
      simulated: true,
      reason: this.reason
    };
  }
}

module.exports = NoopTransport;
