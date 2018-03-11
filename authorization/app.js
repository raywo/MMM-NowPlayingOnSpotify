'use strict';


/**
 * This is an example of a basic node.js script that performs
 * the Authorization Code oAuth2 flow to authenticate against
 * the Spotify Accounts.
 *
 * For more information, read
 * https://developer.spotify.com/web-api/authorization-guide/#authorization_code_flow
 */
const express = require('express'); // Express web server framework
const request = require('request'); // 'Request' library
const querystring = require('querystring');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');

const port = 8888;
let client_id = '';
let client_secret = '';
let redirect_uri = '';


/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
function generateRandomString(length) {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}


function getError() {
  let error = '';

  if (!client_id) {
    error = 'clientID';
  }

  if (!client_secret) {
    error += ', clientSecret';
  }
  return error;
}


function redirectToError(response, error) {
  let url = '/#';
  let urlParams = {
    error: error,
    clientID: client_id,
    clientSecret: client_secret
  };

  response.redirect(url + querystring.stringify(urlParams));
}


function redirectToAuthorization(response, state) {
  // your application requests authorization
  const scope = 'user-read-playback-state user-read-currently-playing';
  let url = 'https://accounts.spotify.com/authorize?';
  let urlParams = {
    response_type: 'code',
    client_id: client_id,
    scope: scope,
    redirect_uri: redirect_uri,
    state: state
  };

  response.redirect(url + querystring.stringify(urlParams));
}


function redirectToSuccess(response, body) {
  let access_token = body.access_token;
  let refresh_token = body.refresh_token;

  // we can also pass the token to the browser to make requests from there
  response.redirect('/#' +
    querystring.stringify({
      access_token: access_token,
      refresh_token: refresh_token,
      client_id: client_id,
      client_secret: client_secret
    }));
}


function getAuthOptions(code) {
  return {
    url: 'https://accounts.spotify.com/api/token',
    form: {
      code: code,
      redirect_uri: redirect_uri,
      grant_type: 'authorization_code'
    },
    headers: {
      'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
    },
    json: true
  };
}


let stateKey = 'spotify_auth_state';
let app = express();

app.use(express.static(__dirname + '/public'));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));


app.post('/login', function (req, response) {
  let state = generateRandomString(16);
  response.cookie(stateKey, state);

  client_id = req.body.clientID;
  client_secret = req.body.clientSecret;
  redirect_uri = req.body.redirectURI;

  let error = getError();

  if (error) {
    redirectToError(response, error);
  } else {
    redirectToAuthorization(response, state);
  }
});


app.get('/callback', function (req, res) {
  // your application requests refresh and access tokens
  // after checking the state parameter
  let code = req.query.code || null;
  let state = req.query.state || null;
  let storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    redirectToError(res, 'state_mismatch');

  } else {
    res.clearCookie(stateKey);

    request.post(getAuthOptions(code), function (error, response, body) {
      if (!error && response.statusCode === 200) {
        redirectToSuccess(res, body);
      } else {
        redirectToError(res, 'invalid_token');
      }
    });
  }
});


console.log('Listening on %s', port);
console.log('You can now open your browser and visit localhost:%s', port);
app.listen(port);