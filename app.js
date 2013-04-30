
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
  , async = require('async');

var couchConfig = {
	"hosts": ["96.126.118.232:8091"],
	"user": "Administrator",
	"password": "skr4mj3t",
	"bucket": "tvpod"
};

var showInfoURL = "http://services.tvrage.com/myfeeds/search.php?key=8qMVmfV7aDsZdQ9pTIui&show=";

var app = express();
var cb = null;



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


couchbase.connect(couchConfig, function(err, bucket) {
	if(err) {
		console.log(err);
	} else {
		cb = bucket;
		main();
	}
});

function main() {		
	
	var ftp = new ftpclient();
	ftp.connect({
		host: 'nqhf057.dediseedbox.com',
		user: 'codevinsky',
		password: 'skr4mj3t'
	});
	ftp.on('ready', function() {
		ftp.list('/',function(err,list) {
			if (err)
				console.log(err);
			else
				list.forEach(function(item) {
					if (item.type != 'd')
						getMediaType(item.name);
				});
		});
	});
	


	
}


function getMediaType(filename) {
	if (filename.match(/\.s\d{2,}e\d{2,}/i))
		getTvInfo(filename);
	
}


function getTvInfo(filename) {
	var showName = filename.split(/\.s\d{2,}e\d{2,}/i)[0].toLowerCase();
	async.series({
	checkdb: function(checkCallback) {
		cb.get(showName,function(err,doc, meta) {
			if (err) {
				console.log('error: ' + err);
				
				async.series({
					tvInfo: function(callback) {
						console.log('requesting show info: ' + showInfoURL + showName);
						var req = http.get(showInfoURL + 'parks.and.recreation', function(res) {
							console.dir(res.statusCode);
							var xml = '';
							res.on('data', function (chunk) {
					    		xml+=chunk
					  		});	
					  		res.on('end', function() {
					  			parseString(xml,function(err,result) {
					  				if(err) 
					  					callback(err,null);
					  				else 
					  					callback(null,result);
					  			});
					  		});
						});

						req.on('error', function(e) {
								console.log('problem with request: ' + e.message);
								callback(e,null);
						});
					}
				}, function(err, res) {
					checkCallback(err,res)
				});
			}
		},function(err,res) {
			
		}
	}
	var seasonAndEpisode = filename.match(/s\d{2,}e\d{2,}/i)[0];
	var season = seasonAndEpisode.match(/\d{2,}/)[0];
	var episode = seasonAndEpisode.match(/\d{2,}$/)[0];
	/*
	console.log(showName);
	console.log(seasonAndEpisode);
	console.log(season);
	console.log(episode);
	*/
}



