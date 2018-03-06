"use strict";


/**
 * This is an example of a basic node.js script that performs
 * the Authorization Code oAuth2 flow to authenticate against
 * the Spotify Accounts.
 *
 * For more information, read
 * https://developer.spotify.com/web-api/authorization-guide/#authorization_code_flow
 */
const express = require("express"); // Express web server framework
const request = require("request"); // "Request" library
const querystring = require("querystring");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");


const redirect_uri = "http://localhost:8888/callback"; // Your redirect uri
let client_id = "";
let client_secret = "";


/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
let generateRandomString = function (length) {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};


let stateKey = "spotify_auth_state";

let app = express();


app.use(express.static(__dirname + '/public'))
  .use(cookieParser())
  .use(bodyParser.json())
  .use(bodyParser.urlencoded({ extended: true }));


app.post('/login', function(req, res) {
  let state = generateRandomString(16);
  res.cookie(stateKey, state);

  client_id = req.body.clientID;
  client_secret = req.body.clientSecret;

  let error = "";

  if (!client_id) {
    error = "clientID";
  }

  if (!client_secret) {
    error += ", clientSecret";
  }

  if (error) {
    res.redirect("/#" +
      querystring.stringify({
        error: error,
        clientID: client_id,
        clientSecret: client_secret
      }));

  } else {
    // your application requests authorization
    const scope = "user-read-playback-state user-read-currently-playing";
    res.redirect('https://accounts.spotify.com/authorize?' +
      querystring.stringify({
        response_type: 'code',
        client_id: client_id,
        scope: scope,
        redirect_uri: redirect_uri,
        state: state
      }));
  }
});


app.get('/callback', function(req, res) {

  // your application requests refresh and access tokens
  // after checking the state parameter

  let code = req.query.code || null;
  let state = req.query.state || null;
  let storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
  } else {
    res.clearCookie(stateKey);
    let authOptions = {
      url: "https://accounts.spotify.com/api/token",
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: "authorization_code"
      },
      headers: {
        "Authorization": "Basic " + (new Buffer(client_id + ":" + client_secret).toString("base64"))
      },
      json: true
    };

    request.post(authOptions, function(error, response, body) {
      if (!error && response.statusCode === 200) {

        let access_token = body.access_token;
        let refresh_token = body.refresh_token;

        // we can also pass the token to the browser to make requests from there
        res.redirect('/#' +
          querystring.stringify({
            access_token: access_token,
            refresh_token: refresh_token,
            client_id: client_id,
            client_secret: client_secret
          }));
      } else {
        res.redirect('/#' +
          querystring.stringify({
            error: 'invalid_token'
          }));
      }
    });
  }
});


console.log("Listening on 8888");
console.log("You can now open your browser and visit localhost:8888");
app.listen(8888);