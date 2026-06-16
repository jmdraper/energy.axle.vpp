'use strict';

const Homey = require('homey');

class AxleVppApp extends Homey.App {

  async onInit() {
    this.log('Axle VPP app is running');
  }

}

module.exports = AxleVppApp;
