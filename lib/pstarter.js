var cluster = require('cluster'), fs = require('fs'), os = require('os');
var exec = require('child_process').exec;
var http = require('http');
var path = require('path');

/* if worker die less than this milliseconds then will not fork new worker */
var MIMIMUM_AGE = 2000;
var conf;
var config = {};

var shuttingDown = false;

var PID_FILE = null;
var AS_USER = 'www-data';

/* between worker restart */
var gracefulStep = 1000;
var nodejs = '';
var serverName = '';
var statistics = {
	workerCount : 0,
	requestCount : 0,
	startDate : new Date(),
	workers : {
		/*
		 * hash by worker id
		 * count : 0
		 * startDate : null
		 */
	},
	deadWorkers : {
	}
};

process.argv.forEach(function(val, index, array) {
	if(index == 0) {
		nodejs = val;
	} else if(index == 1) {
		serverName = val.split('/').pop();
	} else {
		if(val.indexOf('=')) {
			var kv = val.split('=');
			k = kv.shift();
			v = kv.shift();
			if(v && k) {
				process.env[k] = v;
			}
		}
	}
});
if('PID_FILE' in process.env) {
	PID_FILE = process.env['PID_FILE'];
}

if('AS_USER' in process.env) {
	AS_USER = process.env['AS_USER'];
}

var cmd = module.exports.cmd = {
	'requestCount' : 'requestCount'
};

module.exports.statServer = function(port, host) {
	var host = host || '127.0.0.1';
	var server = http.createServer(function(req, res) {
		res.end(JSON.stringify(statistics));
	});
	server.listen(port, host, function() {
		console.log('stats server on 127.0.0.1:' + port);
	});
};
/**
 * No guarantee
 */
function isRunning(pid, callback) {
	var command;
	if(!pid) {
		callback(false);
		return;
	}
	command = 'ps -ef | grep \'' + nodejs + '\'| grep \'' + serverName + '\' | grep -v grep | awk \'{print $2}\'';
	exec(command, function(err, stdout, stderr) {
		var pids;
		if(err || stderr) {
			callback(false);
			return;
		}
		pids = stdout.trim().split("\n");
		if(pids.indexOf(pid) != -1) {
			callback(true);
			return;
		}
		callback(false);
	});
}

function messageHandler(msg, pid) {
	try {
		if(msg && msg.cmd) {
			switch(msg.cmd) {
				case cmd.requestCount:
					statistics.requestCount++;
					if(pid && statistics.workers[pid]) {
						statistics.workers[pid].count++;
					}
					break;
			}
		}
	} catch(e) {

	}
}

function workerOnfork(worker) {

	worker.once('listening', function(address) {
		console.info('Worker ' + worker.process.pid + ' is listening at ' + address.address + ':' + address.port);
	});
	worker.once('online', function() {
		console.info('Worker ' + worker.process.pid + ' is online');
	});
	worker.created = Date.now();
	Object.defineProperty(worker, 'age', {
		get : function() {
			return Date.now() - this.created;
		}
	});
	
	worker.on('message', function(msg) {
		messageHandler(msg, worker.process.pid);
	});
	
	statistics.workerCount++;
	statistics.workers[worker.process.pid] = {
		created : new Date(worker.created),
		count : 0
	};
}

function killWorker(pid, delay, signal) {
	var signal = (signal == 'SIGUSR2') ? 'SIGUSR2' : 'SIGTERM';
	if(delay > 0) {
		setTimeout(function() {
			try {
				process.kill(pid, signal);
			} catch(e) {
			}
		}, delay);
	} else {
		try {
			process.kill(pid, signal);
		} catch(e) {
		}
	}
}

function gracefulWorker(worker, delay) {
	setTimeout(function() {
		worker.disconnect();
		killWorker(worker.process.pid, 1000, 'SIGUSR2');
	}, delay);
}

// Fork workers.
function forkWorkers(numWorkers, env) {
	var workers = [];
	env = env || {};
	for(var i = 0; i < numWorkers; i++) {
		worker = cluster.fork(env);
		console.info("Start worker: " + worker.process.pid);
		workers.push(worker);
	}
	return workers;
}

function loadConfig(confFile) {
	if( typeof confFile == 'string') {
		config = require(confFile);
	} else if( typeof confFile == 'object') {
		config = confFile;
	}

	if(!config.http) {
		config.http = {};
		config.http.numWorkers = os.cpus().length;
	} else if(!config.http.numWorkers) {
		config.http.numWorkers = os.cpus().length;
	}

}

module.exports.startMaster = function(confFile, masterSettings, callback) {
	if(cluster.isMaster) {
		console.info('Master start at:', (new Date()).toISOString());
		console.info('Master pid:', process.pid);
		console.time('Master start time');
		conf = confFile;
		loadConfig(conf);

		if(!PID_FILE) {
			if(config.PID_FILE) {
				PID_FILE = config.PID_FILE;
			} else {
				console.warn('No pid file specified. Use ./pstarter.pid');
				PID_FILE = 'pstarter.pid';
			}
		}
		var pid = null;
		
		if (fs.existsSync(PID_FILE)) {
			pid = fs.readFileSync(PID_FILE, 'utf8');
		}

		isRunning(pid, function(running) {
			if(running) {
				console.error('Running process exists');
				console.error('Not starting a new master');
				console.error('pstarter exits');
				console.error('Please check process id: ' + pid);
				process.exit(1);
			}

			if(masterSettings) {
				cluster.setupMaster(masterSettings);
			}

			cluster.on('fork', workerOnfork);

			cluster.on('exit', function(worker, code, signal) {
				console.info('worker ' + worker.process.pid + ' died at ' + (new Date()).toISOString());
				if(statistics.workers[worker.process.pid]) {
					/* move to dead workers */
					statistics.deadWorkers[worker.process.pid] = statistics.workers[worker.process.pid];
					statistics.deadWorkers[worker.process.pid].died = new Date().toISOString();
					statistics.deadWorkers[worker.process.pid].suicide = worker.suicide;
					statistics.deadWorkers[worker.process.pid].code = code;
					statistics.deadWorkers[worker.process.pid].signal = signal;
					
					delete statistics.workers[worker.process.pid];
				}
				if(shuttingDown === true) {
					console.info('master is shutting down workers');
					return;
					/* master is shutting down workers. */
				}
				if(Object.keys(cluster.workers).length >= config.http.numWorkers) {
					return;
				}
				if(worker.age < MIMIMUM_AGE) {
					console.error('Worker died to soon');
					return;
				}
				worker = forkWorkers(1).shift();
				console.info('Replace with worker: ' + worker.process.pid);
			});
			/* graceful */
			process.on('SIGUSR2', function() {
				console.info('Get a SIGUSR2 signal (graceful):', (new Date()).toISOString());

				var ids = [], timeout = 0, workerDiff;
				ids = Object.keys(cluster.workers);
				workerDiff = config.http.numWorkers - ids.length;
				
				worker = forkWorkers(1).shift();
				console.info('Create extra worker for better graceful: ' + worker.process.pid);
				worker.on('listening', function(address) {
					console.info('Extra worker ' + worker.process.pid + ' is listening at ' + address.address + ':' + address.port);
					forkWorkers(workerDiff);
					ids.forEach(function(id) {
						gracefulWorker(cluster.workers[id], timeout);
						timeout += gracefulStep;
					});
				});
			});
			/* restart: reload http/master conf before starting workers */
			process.on('SIGHUP', function() {
				console.info('Get a SIGHUP signal (restart):', (new Date()).toISOString());
				var pids = [], workerDiff;

				if( typeof conf == 'string') {
					try {
						delete require.cache[require.resolve(conf)];
						loadConfig(conf);
					} catch(e) {
					}
				}

				Object.keys(cluster.workers).forEach(function(id) {
					cluster.workers[id].disconnect();
					pids.push(cluster.workers[id].process.pid);
				});
				
				workerDiff = config.http.numWorkers - pids.length;
				
				forkWorkers(workerDiff);
				
				pids.forEach(function(pid) {
					killWorker(pid, 0, 'SIGTERM');
				});
			});
			/* stop */
			process.on('SIGTERM', function() {
				console.info('Get a SIGTERM signal (stop):', (new Date()).toISOString());
				shuttingDown = true;
				var pids = [];
				Object.keys(cluster.workers).forEach(function(id) {
					cluster.workers[id].disconnect();
					pids.push(cluster.workers[id].process.pid);
				});

				pids.forEach(function(pid) {
					killWorker(pid, 0, 'SIGTERM');
				});
				fs.unlinkSync(PID_FILE);
				process.exit(0);
			});
			forkWorkers(config.http.numWorkers);

			var fd = fs.openSync(PID_FILE, 'w+');
			fs.writeSync(fd, process.pid);
			fs.close(fd);

			if(callback) {
				callback();
			}
			console.timeEnd('Master start time');
		});
	}

	return this;
};
/**
 * @param {Function} callback
 *  function to execute worker/application code
 * @param {Function} cleanupCallback
 * 	is a function that takes a callback for exiting
 *  or just call process.exit when done
 *  and second argument which describe what kind of signal
 */
module.exports.startWorker = function(callback, cleanupCallback) {
	if(cluster.isWorker) {
		if(AS_USER) {
			try {
				process.setuid(AS_USER);
			} catch(e) {
				console.warn(e);
			}
		}
		process.on('SIGUSR2', function() {
			console.info('Process is under killed: ' + process.pid);
			console.info('Graceful');
			/* doing cleanup before exit */
			if(cleanupCallback) {
				cleanupCallback(function() {
					process.exit(0);
				}, 'SIGUSR2');
			} else {
				process.exit(0);
			}
		});

		process.on('SIGTERM', function() {
			console.info('Process is under killed: ' + process.pid);
			console.info('Stop/kill');
			/* doing cleanup before exit */
			if(cleanupCallback) {
				cleanupCallback(function() {
					process.exit(0);
				}, 'SIGTERM');
			} else {
				process.exit(0);
			}
		});
		if(callback) {
			callback();
		}
	}
	return this;
};


var handleWatch = function(event, filename, exts) {
	console.log(filename);
	switch(event) {
		case 'change':
		case 'rename':
			if(filename) {
				if(exts.indexOf(path.extname(filename)) != -1) {
					process.kill(process.pid, 'SIGHUP');
				}
			} else {
				process.kill(process.pid, 'SIGHUP');
			}
			break;
	}
};

module.exports.startWatch = function(root, skipFolders, exts) {
	if(cluster.isMaster) {
		var exts = exts || ['.js', '.json', '.html', '.ejs', '.css'];
		var root = root || __dirname;
		var skipFolders = skipFolders || [];
		var watch = function(folder) {
			if(skipFolders.indexOf(folder) == -1) {
				fs.watch(folder, function(event, filename) {
					handleWatch(event, filename, exts);
				});
				files = fs.readdirSync(folder);
				files.forEach(function(file) {
					stat = fs.statSync(folder + '/' + file);
					if(stat.isDirectory()) {
						watch(folder + '/' + file);
					}
				});
			}

		};
		watch(root);
	}
};
