var express = require("express");
const request = require("request");
const exphbs = require("express-handlebars");
const bodyParser = require("body-parser");
const path = require("path");
const rp = require("request-promise");

var app = express();

//handlebars middleware
app.engine(
  "handlebars",
  exphbs({
    defaultLayout: "main"
  })
);
app.set("view engine", "handlebars");

//body-parser middleware
app.use(
  bodyParser.urlencoded({
    extended: false
  })
);
app.use(bodyParser.json());

//change time string into date format
function toDate(dStr, format) {
  var now = new Date();
  if (format == "h:m") {
    now.setHours(dStr.substr(0, dStr.indexOf(":")));
    now.setMinutes(dStr.substr(dStr.indexOf(":") + 1));
    now.setSeconds(0);
    return now;
  } else return "Invalid Format";
}

function eta(timeNow, timeArrive) {
  var ans = "";
  var temp = timeArrive - timeNow;
  if (temp < 60000) {
    ans = "Arriving Now";
  } else {
    temp = temp / 60000;
    temp = Math.floor(temp);
    ans = temp + " min away";
  }
  return ans;
}

function parseTime(expected) {
  var temp = expected.split("");
  var index = 0;
  for (var i = 0; i < temp.length; i++) {
    if (temp[i] == "T") {
      index = i;
    }
  }
  var ans = temp.slice(index + 1, index + 6).join("");
  return ans;
}

//Landing Page
app.get("/", function(req, res) {
  res.render("index");
});

var address = "";
var lat;
var long;
app.post("/landing", function(req, res) {
  address = req.body.address;
  address = address.split(" ").join("+");

  const findLocation = {
    url:
      "http://www.mapquestapi.com/geocoding/v1/address?key=BgwFUwZSUx5WJZPlYZdLaCqxjI0sYnkf&location=" +
      address,
    method: "GET"
  };

  //find all stop locations based on long and lat

  rp(findLocation)
    .then(function(body) {
      let json = JSON.parse(body);
      lat = json.results[0].locations[0].latLng.lat;
      long = json.results[0].locations[0].latLng.lng;
    })
    .then(function() {
      const findStops = {
        url:
          "http://bustime.mta.info/api/where/stops-for-location.json?lat=" +
          lat +
          "&lon=" +
          long +
          "&latSpan=0.005&lonSpan=0.005&key=99b6207b-6a51-42bc-80cc-1a6fa0e73031",
        method: "GET"
      };
      return rp(findStops);
    })
    .then(function(body) {
      let json = JSON.parse(body);
      var stops = [];
      for (var i = 0; i < json.data.stops.length; i++) {
        if (i > json.data.stops.length) {
          break;
        }
        var stopInfo = {};
        stopInfo.stopName = json.data.stops[i].name;
        stopInfo.direction = json.data.stops[i].direction;
        stopInfo.refCode = json.data.stops[i].code;
        stopInfo.routes = [];

        for (var x = 0; x < json.data.stops[i].routes.length; x++) {
          var routeInfo = {
            shortName: json.data.stops[i].routes[x].shortName,
            longName: json.data.stops[i].routes[x].longName,
            description: json.data.stops[i].routes[x].description
          };
          stopInfo.routes.push(routeInfo);
        }
        stops.push(stopInfo);
      }

      const findTime = {
        url:
          "http://bustime.mta.info/api/siri/stop-monitoring.json?key=99b6207b-6a51-42bc-80cc-1a6fa0e73031&OperatorRef=MTA&MonitoringRef=",
        method: "GET"
      };

      const originalUrl =
        "http://bustime.mta.info/api/siri/stop-monitoring.json?key=99b6207b-6a51-42bc-80cc-1a6fa0e73031&OperatorRef=MTA&MonitoringRef=";

      var requestAsync = function(url) {
        return new Promise((resolve, reject) => {
          var req = request(url, (err, response, body) => {
            if (err) return reject(err, response, body);
            resolve(JSON.parse(body));
          });
        });
      };

      var urls = [];

      for (let q1 = 0; q1 < stops.length; q1++) {
        urls.push(originalUrl + stops[q1].refCode);
      }

      async function getParallel() {
        let data = await Promise.all(urls.map(requestAsync));

        for (let index = 0; index < data.length; index++) {
          for (let routeI = 0; routeI < 2; routeI++) {
            if (stops[index].routes[routeI] == null || stops[index] == null) {
              break;
            }

            for (
              let monI = 0;
              monI <
              data[index].Siri.ServiceDelivery.StopMonitoringDelivery[0]
                .MonitoredStopVisit.length;
              monI++
            ) {
              if (
                stops[index].routes[routeI].shortName ===
                data[index].Siri.ServiceDelivery.StopMonitoringDelivery[0]
                  .MonitoredStopVisit[monI].MonitoredVehicleJourney
                  .PublishedLineName
              ) {
                if (
                  data[index].Siri.ServiceDelivery.StopMonitoringDelivery[0]
                    .MonitoredStopVisit[monI].MonitoredVehicleJourney
                    .MonitoredCall.ExpectedArrivalTime != null
                ) {
                  let expected =
                    data[index].Siri.ServiceDelivery.StopMonitoringDelivery[0]
                      .MonitoredStopVisit[monI].MonitoredVehicleJourney
                      .MonitoredCall.ExpectedArrivalTime;
                  let arrivalTime = parseTime(expected);
                  let arrivalDate = toDate(arrivalTime, "h:m");
                  let nowDate = new Date();
                  let coming = eta(nowDate, arrivalDate);
                  stops[index].routes[routeI].comings = coming;
                  monI = 10000;
                }
              }
            }
          }
        }
        return data;
      }

      getParallel().then(function(data) {
        for (let j = 0; j < stops.length; j++) {
          if (!stops[j].routes[0].comings) {
            stops.splice(j, 1);
            j--;
          }
        }
        res.render("landing", {
          stops: stops
        });
      });
    })
    .catch(function(err) {
      console.log(err);
    });
});

app.use(express.static(path.join(__dirname, "public")));

//Start Server
app.listen(process.env.PORT || 3000, function() {
  console.log("hello");
});

// request for bus stop locations for long/let
//http://bustime.mta.info/api/where/stops-for-location.json?lat=40.7795194&lon=-73.9470266&latSpan=0.005&lonSpan=0.005&key=99b6207b-6a51-42bc-80cc-1a6fa0e73031

//request for long/lat of a location
//https://maps.googleapis.com/maps/api/geocode/json?address=1600+Amphitheatre+Parkway,+Mountain+View,+CA&key=AIzaSyB0lYZ9tWj9VbN3lbejlruLvvKXef5Z_aA

//get bus times for specific stop id
// http://bustime.mta.info/api/siri/stop-monitoring.json?key=99b6207b-6a51-42bc-80cc-1a6fa0e73031&OperatorRef=MTA&MonitoringRef=401715

// get arrival time
//json.Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit[0].MonitoredVehicleJourney.MonitoredCall.ExpectedArrivalTime
