#!/usr/bin/env node
var util	= require( 'util' );
var path	= require( 'path' );
var fs		= require( 'fs' );
var socket_io	= require( 'socket.io' );
var http	= require( 'http' );

function debug( msg ){
	util.log( msg )
};

debug( "Starting up.." );

t_thisScript	= process.argv[1];
t_root		= path.dirname( t_thisScript );

debug( "Using root '" + t_root + "'." );

t_dirContents	= fs.readdirSync( t_root );
if( t_dirContents.indexOf( "config" ) < 0 ){
	debug( "Couldn't find config." );
	process.exit( 1 );
}

config	= [ ];
debug( "Reading config.." );
t_configContentLines	= fs.readFileSync( path.join( t_root, "config" ), 'utf8' ).split( "\n" );
for( var t_counter=0; t_counter<t_configContentLines.length; t_counter++ ){
	t_configLine	= t_configContentLines[t_counter].replace( "\n$", "" );
	if( t_configLine.match( "^#" ) || t_configLine == "" ){
		continue;
	}

	// Evalute all the lines, exit on an invalid line..
	try {
		eval( t_configLine );
	}catch( e ){
		debug( "Invalid configration line found: Line '" + (t_counter+1) + "'." );
		process.exit( 1 );
	}
}

if( config['debug'] ){
	debug( "Debugging turned on." );
}else{
	debug( "Debugging turned off." );

	// Set the debug function to do nothing.
	t_function	= function( msg ){ };
	debug		= t_function;
}

debug( "Listening on port '" + config['http_port'] + "'." );
server	= http.createServer( handle_request );

io	= socket_io.listen( server );

// Set the debug log to verbose for socket.io if debugging is enabled.
// otherwise set it to 0.. 
if( config['debug'] ){
	io.set( 'log level', 4 );
}else{
	io.set( 'log level', 0 );
}

// Not great, because this doesn't use the broadcast part of socket.io.. but it'll work.
client_list	= [ ];

eval( "todo_lists	= " + fs.readFileSync( config['database_file'], 'utf8' ) );
/*todo_lists	= {
		'robert': [
			{	'name': 'Some task',
				'content': 'Some description of a task to do in the future..',
				'checked': false, },
			{	'name': 'Another task',
				'content': 'nothing special.',
				'checked': true, }
			],
		'edwin': [
			{	'name': 'My task!',
				'content': 'foobar!',
				'checked': false }
			]
		};*/

function notify_todolist_changed( todolist ){
	// Save the state!
	fs.writeFileSync( config['database_file'], JSON.stringify( todo_lists ), 'utf8' );

	for( t_counter in client_list ){
		client_list[t_counter].emit( 'update', { 'list': todolist } );
	}
};

io.sockets.on( 'connection', function( socket ){

	client_list.push( socket );

	socket.on( 'request_all', function( ){
		var t_return	= [ ];
		for( t_todoListName in todo_lists ){
			t_return.push( t_todoListName );
		}
		socket.emit( 'return_all', t_return );
	} );

	socket.on( 'request_one', function( listName ){
		if( todo_lists[listName] != null ){	
			socket.emit( 'return_one', { 'name': listName, 'data': todo_lists[listName] } );
		}else{
			socket.emit( 'return_one', { 'error': 'Invalid todo list specified.' } );
		}
	} );

	// Create the todo list array.. 
	socket.on( 'add_list', function( t_obj ){
		todo_lists[t_obj.todo_list]	= [ ];
		notify_todolist_changed( t_obj.todo_list );
	} );

	socket.on( 'check_task', function( t_obj ){
		t_taskName	= t_obj['task_name'];
		for( t_taskNum in todo_lists[t_obj.todo_list] ){
			t_taskObj	= todo_lists[t_obj.todo_list][t_taskNum];
			if( t_taskName == t_taskObj['name'] ){
				t_taskObj.checked = true;
				notify_todolist_changed( t_obj.todo_list );
			}
		}
	} );

	socket.on( 'uncheck_task', function( t_obj ){
		t_taskName	= t_obj['task_name'];
		for( t_taskNum in todo_lists[t_obj.todo_list] ){
			t_taskObj	= todo_lists[t_obj.todo_list][t_taskNum];
			if( t_taskName == t_taskObj['name'] ){
				t_taskObj.checked = false;
				notify_todolist_changed( t_obj.todo_list );
			}
		}
	} );

	socket.on( 'add_task', function( t_obj ){
		t_objToAdd	= { 'name': t_obj.task_name, 'content': t_obj.task_content, 'checked': false, 'priority': t_obj.priority };
		todo_lists[t_obj['todo_list']].push( t_objToAdd );
		notify_todolist_changed( t_obj.todo_list );
	} );

	socket.on( 'delete_task', function( t_obj ){
		for( t_counter in todo_lists[t_obj.todo_list] ){
			if( todo_lists[t_obj.todo_list][t_counter].name == t_obj.task_name ){
				todo_lists[t_obj.todo_list].splice( t_counter, 1 );
				notify_todolist_changed( t_obj.todo_list );
			}
		}
	} );

	socket.on( 'update_task', function( t_obj ){
		for( t_counter in todo_lists[t_obj.todo_list] ){
			if( todo_lists[t_obj.todo_list][t_counter].name == t_obj.task_name ){
				todo_lists[t_obj.todo_list][t_counter].content	= t_obj.new_task_content;
				todo_lists[t_obj.todo_list][t_counter].priority	= t_obj.new_task_priority;
				notify_todolist_changed( t_obj.todo_list );
			}
		}
	} );
} );

server.listen( config['http_port'] );

function handle_request( req, res ){
	
	t_requestUrl	= req.url.replace( "^/", "" );

	// Default to index.html if nothing was specified.
	if( t_requestUrl == "" || t_requestUrl == "/" ){
		t_requestUrl = "index.html";
	}

	debug( "Request: '" + t_requestUrl + "'." );

	t_possibleFile	= path.join( config['http_root'], t_requestUrl );

	if( path.existsSync( t_possibleFile ) ){
		t_ext	= path.extname( t_possibleFile );
		if( t_ext == ".html" ){
			res.writeHead( 200, { 'Content-Type': 'text/html' } );
		}else if( t_ext == ".css" ){
			res.writeHead( 200, { 'Content-Type': 'text/css' } );
		}else if( t_ext == ".js" ){
			res.writeHead( 200, { 'Content-Type': 'text/javascript' } );
		}else if( t_ext == ".png" ){
			res.writeHead( 200, { 'Content-Type': 'image/png' } );
		}else{
			res.writeHead( 200 );
		}
	
		t_http_host	= config['http_host'];
		t_http_port	= config['http_port'];
		/*t_http_server	= req.headers.host.split( ":" );
		t_http_host	= t_http_server[0];
		t_http_port	= t_http_server[1];*/

		if( t_ext == ".png" ){
			res.end( fs.readFileSync( t_possibleFile ) );
		}else{
			res.end( fs.readFileSync( t_possibleFile, 'utf8' ).replace( "HTTP_SERVER_HOST", t_http_host ) );
		}
	}else{
		res.writeHead( 404 );
		res.end( "not found.." );
	};
}
