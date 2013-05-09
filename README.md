## Usage example at http://sibox.isgoodness.com

	var pstarter = require('pstarter');
	
	pstarter.startMaster(__dirname + '/config/configs.js', {}, function() {
		var config = require('./config/configs.js');
		pstarter.statServer(config.http.statPort, config.http.statHost);
		if (process.env['NODE_ENV'] && process.env['NODE_ENV'] == 'development') {
			pstarter.startWatch(__dirname, [__dirname +'/node_modules'], ['.js', '.json', '.html', '.css']);
		}
	}).startWorker(function() {
		var config = require('./config/configs.js');
	
		var express = require('express');
		var bootstrap = require('./app/bootstrap.js');
		var app = express.createServer();
	
		bootstrap.setupApp(app, __dirname);
		bootstrap.bootstrap(app);
		bootstrap.postrun();
		app.listen(config.http.port, config.http.ip);
	});

## Or run separate worker file
### master.js
	var pstarter = require('pstarter');

	pstarter.startMaster({}, {exec: './worker.js'});
	
### worker.js
	var pstarter = require('pstarter');
	pstarter.startWorker(function() {
		console.log('Hello world!');
	});

## Methods
### startMaster(confFile, masterSettings, callback)
* `confFile` - configuration file or object. Only PID_FILE and http.numWorkers are used at the moment
* `masterSettings` - See http://nodejs.org/api/cluster.html#cluster_cluster_setupmaster_settings
* `callback` - function which will be called when master has forked workers

### startWorker(callback, cleanupCallback)
* `callback` - will call when worker has attached listener on exit signal
* `cleanupCallback` - will call when worker receives exit signal. It pass a function for terminating process (or you can choose to exit).

### startWatch(root, skipFolders, exts)
* `root` top folder to watch, all subfolder will also be watched
* `skipFolders` Array of folders you want to skip, absolute path
* `exts` Array of extension to listen on changes, including "." 

## Start with init script on Ubuntu

You need to create a symbolic link /etc/init.d/pstarter to pstarter/etc/init.d/pstarter and make pstarter executable.
You need also specify NODE_BIN, SERVER, PID_FILE, AS_USER, NODEJS and NODE_ENV if your application uses it:
* `NODE_BIN` folder which contains SERVER
* `SERVER` application/server file to execute
* `PID_FILE` should be /var/run/pstarter.pid in production linux
* `AS_USER` the username or uid that you want to run your app (worker) with
* `NODEJS` executable nodejs 
* `NODE_ENV` for your own application; normally development/production


### Start workers

	sudo /etc/init.d/pstarter start


### Old workers will exit directly and new workers created

	sudo /etc/init.d/pstarter restart
	
	

### Old workers will exit graceful one at the time and replaced with a new one
	
	sudo /etc/init.d/pstarter graceful
	

### Run stop (bellow) and start command will be executed

	sudo /etc/init.d/pstarter force-restart

### Old workers exit directly; parent exits

	sudo /etc/init.d/pstarter stop
	
## Register init script for startup at reboot in Ubuntu

	cd /etc/init.d/
	sudo update-rc.d pstarter defaults

