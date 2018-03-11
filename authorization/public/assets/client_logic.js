'use strict';


(function () {
  let loggedinPlaceholder = document.getElementById('loggedin-placeholder');
  let step3Placeholder = document.getElementById('step3-placeholder');
  let userProfileTemplate = compileUserProfile();
  let errorTemplate = compileErrorTemplate();

  let params = getHashParams();
  let error = params.error;

  renderStep1Content({redirectUri: getRedirectURI()});
  renderForm();
  renderConfig();

  if (error) {
    handleErrors(error);
  } else {
    renderPage();
  }


  function renderPage() {
    if (params.access_token) {
      // render success panel
      $.ajax({
        url: 'https://api.spotify.com/v1/me',
        headers: {
          'Authorization': 'Bearer ' + params.access_token
        },
        success: function (response) {
          step3Placeholder.innerHTML = null;
          loggedinPlaceholder.innerHTML = userProfileTemplate(response);

          let configParams = {
            clientID: params.client_id,
            clientSecret: params.client_secret,
            accessToken: params.access_token,
            refreshToken: params.refresh_token,
            success: true
          };

          renderStep1Content();
          renderConfig(configParams);
          renderSuccessScreen();
        }
      });

    } else {
      renderInitialScreen();
    }
  }


  function renderInitialScreen() {
    $('#login').show();
    $('#loggedin').hide();
  }


  function renderSuccessScreen() {
    $('#login').hide();
    $('#loggedin').show();
  }


  function renderStep1Content(params) {
    let step1Source = document.getElementById('step1-template').innerHTML;
    let step1Template = Handlebars.compile(step1Source);
    let step1Placeholder = document.getElementById('step1-placeholder');

    step1Placeholder.innerHTML = step1Template(params);
  }


  function renderForm(params) {
    let formSource = document.getElementById('form-template').innerHTML;
    let formTemplate = Handlebars.compile(formSource);
    let formPlaceholder = document.getElementById('form-placeholder');

    if (params) {
      params.redirectURI = getRedirectURI();
    } else {
      params = {redirectURI: getRedirectURI()};
    }

    formPlaceholder.innerHTML = formTemplate(params);
  }


  function renderConfig(params) {
    let template = compileConfigTemplate();
    let placeholder = document.getElementById('config-placeholder');

    if (!params) {
      params = {};
    }

    if (!params.clientID) {
      params.clientID = '<YOUR-CLIENT-ID>';
    }

    if (!params.clientSecret) {
      params.clientSecret = '<YOUR-CLIENT-SECRET>';
    }

    placeholder.innerHTML = template(params);
  }


  function handleErrors(err) {
    if (err.includes('clientID') || err.includes('clientSecret')) {
      let formParams = Object.assign(getParamsForClientIDError(err), getParamsForClientSecretError(err));
      renderForm(formParams);
      renderInitialScreen();

    } else if (err.includes('invalid_token')) {
      loggedinPlaceholder.innerHTML = errorTemplate();
      step3Placeholder.innerHTML = compileStep3Template()();
      renderSuccessScreen();
    }
  }


  function getParamsForClientIDError(err) {
    let formParams = {};

    if (err.includes('clientID')) {
      formParams.clientIDClass = 'is-invalid';
      formParams.clientIDFeedbackClass = 'invalid-feedback';
      formParams.clientIDFeedBackText = 'Please provide your client ID!';
      formParams.clientIDValue = params.clientID;
    } else {
      formParams.clientIDClass = 'is-valid';
      formParams.clientIDFeedbackClass = 'valid-feedback';
      formParams.clientIDFeedBackText = 'Looks good!';
      formParams.clientIDValue = params.clientID;
    }

    return formParams;
  }

  function getParamsForClientSecretError(err) {
    let formParams = {};

    if (err.includes('clientSecret')) {
      formParams.clientSecretClass = 'is-invalid';
      formParams.clientSecretFeedbackClass = 'invalid-feedback';
      formParams.clientSecretFeedBackText = 'Please provide your client secret!';
      formParams.clientSecretValue = params.clientSecret;
    } else {
      formParams.clientSecretClass = 'is-valid';
      formParams.clientSecretFeedbackClass = 'valid-feedback';
      formParams.clientSecretFeedBackText = 'Looks good!';
      formParams.clientSecretValue = params.clientSecret;
    }

    return formParams;
  }


  /**
   * Obtains parameters from the hash of the URL
   * @return Object
   */
  function getHashParams() {
    let hashParams = {};
    let e, r = /([^&;=]+)=?([^&;]*)/g;
    let q = window.location.hash.substring(1);

    while (e = r.exec(q)) {
      hashParams[e[1]] = decodeURIComponent(e[2]);
    }

    return hashParams;
  }


  function compileUserProfile() {
    let userProfileSource = document.getElementById('user-profile-template').innerHTML;

    return Handlebars.compile(userProfileSource);
  }


  function compileErrorTemplate() {
    let errorSource = document.getElementById('error-template').innerHTML;

    return Handlebars.compile(errorSource);
  }


  function compileStep3Template() {
    let step3Source = document.getElementById('step3-template').innerHTML;

    return Handlebars.compile(step3Source);
  }


  function compileConfigTemplate() {
    let configSource = document.getElementById('config-template').innerHTML;

    return Handlebars.compile(configSource);
  }

  function getRedirectURI() {
    return window.location.protocol + '//' + window.location.host + '/callback';
  }
})();