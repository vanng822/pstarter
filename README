Usage example at http://sibox.isgoodness.com
==========

var pstarter = require('./lib/pstarter.js');

pstarter.startMaster(__dirname + '/config/configs.js').startWorker(function() {
	var config = require('./config/configs.js');

	var express = require('express');
	var bootstrap = require('./app/bootstrap.js');
	var app = express.createServer();

	bootstrap.setupApp(app, __dirname);
	bootstrap.bootstrap(app);
	bootstrap.postrun();
	app.listen(config.http.port, config.http.ip);
});


Start with init script on Ubuntu
You need to create a symbolic link /etc/init.d/pstarter to pstarter/etc/init.d/pstarter and make pstarter executable.

sudo /etc/init.d/pstarter start
Start workers

sudo /etc/init.d/pstarter restart
Old workers will exit directly and new workers created

sudo /etc/init.d/pstarter graceful
Old workers will exit graceful one at the time and replaced with a new one

sudo /etc/init.d/pstarter force-restart
Run stop (bellow) and start command will be executed

sudo /etc/init.d/pstarter stop
Old workers exit directly; parent exits


