module.exports = * @param {String} message - The text to be sent in this call (ex: "/telegrapher") 

 */		   function genPing(message)  { return JSON_stringify({'cmd': 'chat', "text": "'" + escapeJSONValue($('#msg').val())+"'}); } // sends out our own chat pings via telegram and returns them back, with no additional context information on what was requested by someone else if they said we were able -- just like `/bot` does not have an equivalent of that! Will also print some details about those things so far.. [TODO] Send more info here? Is it worth it anyway?! /p
