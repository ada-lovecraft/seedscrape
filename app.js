
/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes')
  , user = require('./routes/user')
  , http = require('http')
  , path = require('path')
  , ftpclient = require('ftp')
  , parseString = require('xml2js').parseString
  , couchbase = require('couchbase')
  , async = require('async')
  , events = require('events')
  , Mustache = require('mustache');

var radium = new events.EventEmitter();

var couchConfig = {
	"hosts": ["localhost:8091"],
	"user": "Administrator",
	"password": "skr4mj3t",
	"bucket": "tvpod"
};

var showInfoURL = "http://services.tvrage.com/myfeeds/search.php?key=8qMVmfV7aDsZdQ9pTIui&show=";
var episodeInfoURLTemplate = "http://services.tvrage.com/myfeeds/episodeinfo.php?key=8qMVmfV7aDsZdQ9pTIui&sid={{sid}}&ep={{season}}x{{episode}}"

var app = express();
var cb = null;
var unknownSeries = [];
var ftp = new ftpclient();
var ftpQueue = []
	, ftpFail = [];



// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.methodOverride());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

// development only
if ('development' == app.get('env')) {
  app.use(express.errorHandler());
}

app.get('/', routes.index);
app.get('/users', user.list);


radium.on('couchbase:connected', getFileListFromFtp);

couchbase.connect(couchConfig, function(err, bucket) {
	if(err) {
		console.log(err);
	} else {
		cb = bucket;
		radium.emit('couchbase:connected');
	}
});


function getFileListFromFtp(){
	ftp.connect({
		host: 'nqhf057.dediseedbox.com',
		user: 'codevinsky',
		password: 'skr4mj3t'
	});
	ftp.on('ready', function() {
		ftp.list('/',processList);
		
	});
}

function processList(err,list) {
	if (err)
		console.log(err);
	else
		async.each(list,function(item,callback) {
			if (item.type != 'd')
				if (getMediaType(item.name) == 'tv') {
					radium.on(item.name+":seriesNotFound", findSeries);
					radium.on(item.name+":seriesInfo", parseSeriesInfo);
					radium.on(item.name+":episodeNotFound", findEpisode);
					radium.on(item.name+":episodeInfo", parseEpisodeInfo);
					//radium.on(item.name+":unknown", findItem);
					getSeriesInfo(item.name);
				}
			callback();
		}, function(err) {
			console.log('done listing');
			cb.set('filelist',list, function(err,meta){});
		});
}


function getMediaType(filename) {
	if (filename.match(/\.s\d{2,}e\d{2,}/i)) {
		return 'tv';
	}
}
function findSeries(info) {
	getTVRageSeriesInfo(info);
}
function parseSeriesInfo(info) {
	getEpisodeInfo(info);
}



function findEpisode(info) {
	getTVRageEpisodeInfo(info);
}

function parseEpisodeInfo(info) {
	console.log("parsing");
	if (info.file == 'Lost.S01E01.zip')
		addToQueue(info);
}

function getSeriesInfo(filename) {
	var showName = filename.split(/\.s\d{2,}e\d{2,}/i)[0].toLowerCase();

	cb.get(showName,function(err,doc, meta) {
		if (err) {
			radium.emit(filename+":seriesNotFound",filename);
		} else {
			var seasonAndEpisode = filename.match(/s\d{2,}e\d{2,}/i)[0];
			var season = seasonAndEpisode.match(/\d{2,}/)[0];
			var episode = seasonAndEpisode.match(/\d{2,}$/)[0];
			radium.emit(filename+':seriesInfo',{rageInfo: doc, season: season, episode: episode,filename: filename} );
		}
	}); 
}


function getTVRageSeriesInfo(filename) {
	var showName = filename.split(/\.s\d{2,}e\d{2,}/i)[0].toLowerCase();
	var req = http.get(showInfoURL + showName, function(res) {
		var xml = '';
		res.on('data', function (chunk) {
    		xml+=chunk
  		});	
  		res.on('end', function() {
  			parseString(xml,function(err,result) {
  				if(err) 
  					console.log('error: ' + err)
  				else {
  					var rage = convertSeriesRageObject(result);
  					var seriesObject = {
  						doctype: 'series',
  						showid: rage.showid,
  						name: rage.name,
  						files: [],
  						genres: rage.genres
  					}
					cb.add(showName, seriesObject,function(err, meta) {
						if (err)
							console.log(err);
						radium.emit(filename + ":seriesInfo",seriesObject);
					});
  				}
  			});
  		});
	});

	req.on('error', function(e) {
			console.log('problem with request: ' + e.message);
	});
}

function getEpisodeInfo(info) {

	cb.get(info.filename,function(err,doc, meta) {
		if (err) {
			radium.emit(info.filename+":episodeNotFound",info);
		} else
			radium.emit(info.filename+":episodeInfo",  doc);
	});
}

function getTVRageEpisodeInfo(info) {
	var showName = info.filename.split(/\.s\d{2,}e\d{2,}/i)[0].toLowerCase();
	var view = {
		sid: info.rageInfo.showid
		, season: info.season
		, episode: info.episode
	};
	var url = Mustache.to_html(episodeInfoURLTemplate,view);
	var req = http.get(url, function(res) {
		var xml = '';
		res.on('data', function (chunk) {
    		xml+=chunk
  		});	
  		res.on('end', function() {
  			parseString(xml,function(err,result) {
  				if(err) 
  					console.log('error: ' + err)
  				else {
  					var rage = convertEpisodeRageObject(result);
  					var episodeObject = {
  						doctype: 'episode',
  						showid: view.sid,
  						showname: showName,
  						season: info.season,
  						episode: info.episode,
  						name: rage.title,
  						file: info.filename,
  						downloaded: false
  					};
					
					cb.set(info.filename, episodeObject,function(err, meta) {
						if (err)
							console.log(err);
						else 
							radium.emit(info.filename + ":episodeInfo",episodeObject);
					});
					
  				}
  			});
  		});
	});
}

function convertSeriesRageObject(tvrage) {
	var show = {};
	var s = tvrage.Results.show[0];
	for(key in s) {
		show[key] = s[key][0];
	}
	return show;
}


function convertEpisodeRageObject(tvrage) {
	var episode = {};
	var e = tvrage.show.episode[0];
	for(key in e) {
		episode[key] = e[key][0];
	}
	return episode;
}

function addToQueue(episodeObject) {
	var size = 0;
	cb.get('filelist', function(err,doc,meta) {
		console.log('adding to cue...');
		for(file in doc) {
			console.log(doc[file].name + " :: " + episodeObject.file );
			if(doc[file].name == episodeObject.file) {
				
				//console.log(file.size);
				size = doc[file]['size'];
				queue.push({file: episodeObject.file, size: size});
			}
		}
	});
}

function processQueue() {
	var file = ftpQueue.shift();
	ftp.get(file.name,function(err,reader) {
			if (err) {
				ftpFail.push(file);
				processQueue();
			} else {
				var pieces = 0;
				reader.on('data', function(buffer) {
					pieces += buffer.length;
					var percentage = pieces / size * 100;
					if (percentage == 100)
						processQueue();
				});
			}
		})
	
	});
}


