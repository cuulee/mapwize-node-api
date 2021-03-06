var request = require('request');
request = request.defaults({jar: true});
var _ = require('lodash');
var async = require('async');

module.exports = MapwizeApi;

function getComparableLayer(layer) {
    var comparableLayer = _.pick(layer, ['owner', 'venueId', 'name', 'alias', 'floor', 'isPublished']);
    _.defaults(comparableLayer, {
        alias: layer.name.replace(/\W+/g, '_').toLowerCase(),
        isPublished: false,
        universes: []
    });
    comparableLayer.universes = _.zipObject(comparableLayer.universes, _.times(comparableLayer.universes.length, _.constant(true)));
    return comparableLayer;
};

function getComparablePlace(place) {
    var comparablePlace = _.pick(place, ['owner', 'venueId', 'placeTypeId', 'name', 'alias', 'floor', 'geometry', 'marker', 'entrance', 'order', 'isPublished', 'isSearchable', 'isVisible', 'isClickable', 'style', 'data']);
    _.defaults(comparablePlace, {
        alias: place.name.replace(/\W+/g, '_').toLowerCase(),
        order: 0,
        isPublished: false,
        isSearchable: true,
        isVisible: true,
        isClickable: true,
        style: {},
        data: {},
        universes: []
    });
    comparablePlace.universes = _.zipObject(comparablePlace.universes, _.times(comparablePlace.universes.length, _.constant(true)));
    comparablePlace.translations = _.keyBy(_.map(place.translations, function (translation) {    //Makes the translations comparable by removing the order in the array and the _id field
        return _.omit(translation, ['_id']);
    }), 'language');
    return comparablePlace;
};

function getComparablePlaceList(placeList) {
    var comparablePlaceList = _.pick(placeList, ['owner', 'venueId', 'name', 'alias', 'placeIds', 'isPublished', 'isSearchable', 'data', 'icon']);
    _.defaults(comparablePlaceList, {
        alias: placeList.name.replace(/\W+/g, '_').toLowerCase(),
        isPublished: false,
        isSearchable: true,
        data: {},
        universes: []
    });
    comparablePlaceList.universes = _.zipObject(comparablePlaceList.universes, _.times(comparablePlaceList.universes.length, _.constant(true)));
    comparablePlaceList.translations = _.keyBy(_.map(placeList.translations, function (translation) {    //Makes the translations comparable by removing the order in the array and the _id field
        return _.omit(translation, ['_id']);
    }), 'language');
    return comparablePlaceList;
};

function getComparableConnector(connector) {
    var comparableConnector = _.pick(connector, ['owner', 'venueId', 'name', 'type', 'direction', 'isAccessible', 'waitTime', 'timePerFloor', 'isActive', 'icon']);
    _.defaults(comparableConnector, {
        isAccessible: true,
        waitTime: 0,
        timePerFloor: 0,
        isActive: true,
        icon: null
    });
    return comparableConnector;
};

function syncVenueObjects(objectClass, objectClassCapSingular, objectClassCapPlural, isEqualFunction, MapwizeApiClient, venueId, objects, options, callback) {
    var serverObjects;
    var objectsToUpdate = [];
    var objectsToCreate = [];
    var objectsToDelete = [];

    async.series([
        function (next) {
            // Get all the venue objects from the server and only keep those defined by filter
            MapwizeApiClient['getVenue' + objectClassCapPlural](venueId, function (err, allServerObjects) {
                if (!err) {
                    if (options.filter) {
                        serverObjects = _.filter(allServerObjects, options.filter);
                    } else {
                        serverObjects = allServerObjects;
                    }
                }
                next(err);
            });
        },
        function (next) {
            // Comparing all the objects to know which ones to create/update/delete

            // Creating maps by name as the matching is done on the name
            objectsByName = _.keyBy(objects, 'name');
            serverObjectsByName = _.keyBy(serverObjects, 'name');

            objectNames = _.map(objects, 'name');
            serverObjectNames = _.map(serverObjects, 'name');


            // Compare the objects with similar names
            _.forEach(_.intersection(objectNames, serverObjectNames), function (name) {
                objectsByName[name]._id = serverObjectsByName[name]._id; // We add the _id in the place if found
                objectsByName[name]._syncAction = 'update';
                if (!isEqualFunction(objectsByName[name], serverObjectsByName[name])) {
                    objectsToUpdate.push(objectsByName[name]);
                }
            });

            // Add the objects that are not on the server
            _.forEach(_.difference(objectNames, serverObjectNames), function (name) {
                objectsByName[name]._syncAction = 'create';
                objectsToCreate.push(objectsByName[name]);
            });

            // Delete all the objects that are on the server but not in objects
            _.forEach(_.difference(serverObjectNames, objectNames), function (name) {
                objectsByName[name]._syncAction = 'delete';
                objectsToDelete.push(serverObjectsByName[name]);
            });

            next();
        },
        function (next) {
            console.log('Server objects: ' + serverObjects.length);
            console.log('Objects to create: ' + objectsToCreate.length);
            console.log('Objects to delete: ' + objectsToDelete.length);
            console.log('Objects to update: ' + objectsToUpdate.length);
            next();
        },
        function (next) {
            // Delete objects
            if (!options.dryRun) {
                async.forEachLimit(objectsToDelete, 10, function (object, nextObject) {
                    MapwizeApiClient['delete' + objectClassCapSingular](object._id, nextObject);
                }, next);
            } else {
                next();
            }
        },
        function (next) {
            // Update objects
            if (!options.dryRun) {
                async.forEachLimit(objectsToUpdate, 10, function (object, nextObject) {
                    MapwizeApiClient['update' + objectClassCapSingular](object, nextObject);
                }, next);
            } else {
                next();
            }
        },
        function (next) {
            // Create objects
            if (!options.dryRun) {
                async.forEachLimit(objectsToCreate, 10, function (object, nextObject) {
                    MapwizeApiClient['create' + objectClassCapSingular](object, function (err, createdObject) {
                        if (!err) {
                            object._id = createdObject._id;
                        }
                        nextObject(err);
                    });
                }, next);
            } else {
                next();
            }
        }
    ], callback);
};

function responseWrapper(callback, expectedStatusCode) {
    return function(err, response, body) {
        if (err) {
            callback(err);
        } else if ( (_.isFinite(expectedStatusCode) && response.statusCode == expectedStatusCode) || response.statusCode == 200) {
            callback(null, body);
        } else {
            callback(new Error(JSON.stringify(body)));
        }
    };
};

/**
 * Create a MapwizeApi client
 *
 * @param apiKey the Mapwize API key to use. API keys can be found in the Mapwize admin interface under the Application menu
 * @param organizationId the id of your organization. For now, the use of the API is limited to your organization.
 * @param opts an object with optional parameters
 *  serverUrl the server url to use. Default to production server at https://www.mapwize.io
 * @constructor
 */
function MapwizeApi(apiKey, organizationId, opts) {

    if (!apiKey) {
        throw new Error('Please provide an API key.');
    }
    if (!organizationId) {
        throw new Error('Please provide an organization ID.');
    }
    if (!opts) {
        opts = {};
    }

    this.serverUrl = opts.serverUrl || 'https://www.mapwize.io';
    this.apiKey = apiKey;
    this.organizationId = organizationId;
}

MapwizeApi.prototype = {

    /**
     * Sign in to the API
     *
     * @param email
     * @param password
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the user object if signing in was successful
     */
    signIn: function (email, password, callback) {
        var credentials = {
            email: email,
            password: password
        };
        //console.log(this.serverUrl + '/auth/signin');
        request.post(this.serverUrl + '/auth/signin', {form: credentials, json: true}, responseWrapper(callback));
    },

    /**
     * Get all accessGroups of organization
     *
     * @param callback
     *  error : null or Error('message')
     *  content : the list of access groups if signing in was successful
     */
    getAccessGroups: function (callback) {
        var url = this.serverUrl + '/api/v1/accessGroups?organizationId=' + this.organizationId + '&api_key=' + this.apiKey;
        request.get(url, {json : true}, responseWrapper(callback));
    },

    /**
     * Create an accessGroup
     * The owner need to be specified in the accessGroup object
     *
     * @param accessGroups
     * @param callback
     *  error: null or Error('message')
     *  content: the created accessGroups
     */
    createAccessGroup : function(accessGroup, callback) {
        var url = this.serverUrl + '/api/v1/accessGroups?organizationId=' + this.organizationId + '&api_key=' + this.apiKey;
        request.post(url, {
            body : accessGroup,
            json : true
        }, responseWrapper(callback))
    },

    /**
     * Get all api key of organization
     *
     * @param callback
     *  error: null or Error('message')
     *  content: the list of universes if signing in was successful
     */
    getApiKeys : function (callback) {
        var url = this.serverUrl + '/api/v1/applications?organizationId=' + this.organizationId + '&api_key=' + this.apiKey;
        request.get(url, {json : true}, responseWrapper((callback)));
    },

    /**
     * Create an api key
     *
     * @param apiKey
     * @param callback
     *  error: null or Error('message')
     *  content: the created accessGroups
     */
    createApiKey : function (apiKey, callback) {
        var url = this.serverUrl + '/api/v1/applications?organizationId=' + this.organizationId + '&api_key=' + this.apiKey;
        request.post(url, {
            body : apiKey,
            json : true
        }, responseWrapper(callback))
    },
    
    /**
     * Get all universes of organization
     *
     * @param callback
     *  error: null or Error('message')
     *  content: the list of universes if signing in was successful
     */
    getUniverses: function (callback) {
        var url = this.serverUrl + '/api/v1/universes?organizationId=' + this.organizationId + '&api_key=' + this.apiKey;
        request.get(url, {json: true}, responseWrapper(callback));
    },

    /**
     * Create a universe
     * The owner need to be specified in the universe object
     *
     * @param universe
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the created universe
     */
    createUniverse: function(universe, callback) {
        request.post(this.serverUrl + '/api/v1/universes?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: universe,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Update a universe
     * The universe object needs to contain a valid _id
     *
     * @param universe
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the updated universe
     */
    updateUniverse: function(universe, callback) {
        request.put(this.serverUrl + '/api/v1/universes/' + universe._id + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: universe,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Get all venues of organization (including unpublished)
     *
     * @param callback
     *  error: null or Error('message')
     *  content: the list of venues if signing in was successful
     */
    getVenues: function (callback) {
        var url = this.serverUrl + '/api/v1/venues?organizationId=' + this.organizationId + '&api_key=' + this.apiKey + '&isPublished=all';
        request.get(url, {json: true}, responseWrapper(callback));
    },

    /**
     * Get a venue by id
     *
     * @param callback
     *  error: null or Error('message')
     *  content: the venue if signing in was successful
     */
    getVenue: function (venueId, callback) {
        var url = this.serverUrl + '/api/v1/venues/' + venueId + '?organizationId=' + this.organizationId + '&api_key=' + this.apiKey;
        request.get(url, {json: true}, responseWrapper(callback));
    },

    /**
     * Create a venue
     * The owner need to be specified in the venue object
     *
     * @param venue
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the created venue
     */
    createVenue: function(venue, callback) {
        request.post(this.serverUrl + '/api/v1/venues?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: venue,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Update a venue
     * The venue object needs to contain a valid _id
     *
     * @param venue
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the updated venue
     */
    updateVenue: function(venue, callback) {
        request.put(this.serverUrl + '/api/v1/venues/' + venue._id + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: venue,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Get all places of a venue (including the unpublished places)
     *
     * @param venueId
     * @param callback
     *  error: null or Error('message')
     *  content: the places
     */
    getVenuePlaces: function (venueId, callback) {
        var self = this;

        var emptyResponse = false;
        var page = 0;
        var places = [];

        async.until(
            function () {
                return emptyResponse;
            },
            function (nextPage) {
                page++;

                var url = self.serverUrl + '/api/v1/places?organizationId=' + self.organizationId + '&api_key=' + self.apiKey + '&venueId=' + venueId + '&isPublished=all&page=' + page;
                request.get(url, {json: true}, function (err, response, body) {
                    var serverPlacesPage = [];
                    if (!err && response.statusCode == 200) {
                        serverPlacesPage = body;
                        if (serverPlacesPage.length) {
                            places = _.concat(places, serverPlacesPage);
                        }
                        emptyResponse = serverPlacesPage.length === 0;
                        nextPage();
                    } else {
                        nextPage(err || response.statusCode);
                    }
                });
            },
            function (err) {
                callback(err, places);
            }
        );
    },

    /**
     * Delete a place by id
     *
     * @param placeId
     * @param callback the result callback called with one argument
     *  error: null or Error('message')
     */
    deletePlace: function (placeId, callback) {
        request.delete(this.serverUrl + '/api/v1/places/' + placeId + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, responseWrapper(callback, 204));
    },

    /**
     * Create a place
     * The venueId and the owner need to be specified in the place object
     *
     * @param place
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the created place
     */
    createPlace: function (place, callback) {
        request.post(this.serverUrl + '/api/v1/places?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: place,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Update a place
     * The place object needs to contain a valid _id
     *
     * @param place
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the updated place
     */
    updatePlace: function (place, callback) {
        request.put(this.serverUrl + '/api/v1/places/' + place._id + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: place,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Get all placeLists of a venue (including the unpublished placeLists)
     *
     * @param venueId
     * @param callback
     *  error: null or Error('message')
     *  content: the placeLists
     */
    getVenuePlaceLists: function (venueId, callback) {
        var url = this.serverUrl + '/api/v1/placeLists?organizationId=' + this.organizationId + '&api_key=' + this.apiKey + '&venueId=' + venueId + '&isPublished=all';
        request.get(url, {json: true}, responseWrapper(callback));
    },

    /**
     * Delete a placeList by id
     *
     * @param placeListId
     * @param callback the result callback called with one argument
     *  error: null or Error('message')
     */
    deletePlaceList: function (placeListId, callback) {
        request.delete(this.serverUrl + '/api/v1/placeLists/' + placeListId + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, responseWrapper(callback, 204));
    },

    /**
     * Create a placeList
     * The venueId and the owner need to be specified in the placeList object
     *
     * @param placeList
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the created placeList
     */
    createPlaceList: function (placeList, callback) {
        request.post(this.serverUrl + '/api/v1/placeLists?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: placeList,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Update a placeList
     * The placeList object needs to contain a valid _id
     *
     * @param placeList
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the updated placeList
     */
    updatePlaceList: function (placeList, callback) {
        request.put(this.serverUrl + '/api/v1/placeLists/' + placeList._id + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: placeList,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Get all beacons of a venue (including the unpublished beacons)
     *
     * @param venueId
     * @param callback
     *  error: null or Error('message')
     *  content: the beacons
     */
    getVenueBeacons: function (venueId, callback) {
        var url = this.serverUrl + '/api/v1/beacons?organizationId=' + this.organizationId + '&api_key=' + this.apiKey + '&venueId=' + venueId + '&isPublished=all';
        request.get(url, {json: true}, responseWrapper(callback));
    },

    /**
     * Create a Beacon
     * The venueId and the owner need to be specified in the beacon object
     *
     * @param beacon
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the created beacon
     */
    createBeacon: function (beacon, callback) {
        var url = this.serverUrl + '/api/v1/beacons?api_key=' + this.apiKey + '&organizationId=' + this.organizationId;
        request.post(url, {
            body : beacon,
            json : true
        }, responseWrapper(callback))
    },

    /**
     * update a Beacon
     *
     * @param beacon
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the updated beacon
     */
    updateBeacon: function (beacon, callback) {
        var url = this.serverUrl + '/api/v1/beacons/' + beacon._id + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId;
        request.put(url, {
            body : beacon,
            json : true
        }, responseWrapper(callback))
    },

    /**
     * Delete a Beacon
     *
     * @param beaconId
     * @param callback
     * the result callback called with one arguments
     *  error: null or Error('message')
     */
    deleteBeacon : function (beaconId, callback) {
        request.delete(this.serverUrl + '/api/v1/beacons/' + beaconId + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, responseWrapper(callback, 204));
    },
    
    /**
     * Get all layers of a venue (including the unpublished layers)
     *
     * @param venueId
     * @param callback
     *  error: null or Error('message')
     *  content: the layers
     */
    getVenueLayers: function (venueId, callback) {
        var url = this.serverUrl + '/api/v1/layers?organizationId=' + this.organizationId + '&api_key=' + this.apiKey + '&venueId=' + venueId + '&isPublished=all';
        request.get(url, {json: true}, responseWrapper(callback));
    },

    /**
     * Delete a layer by id
     *
     * @param layerId
     * @param callback the result callback called with one argument
     *  error: null or Error('message')
     */
    deleteLayer: function (layerId, callback) {
        request.delete(this.serverUrl + '/api/v1/layers/' + layerId + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, responseWrapper(callback, 204));
    },

    /**
     * Create a layer
     * The venueId and the owner need to be specified in the layer object
     *
     * @param layer
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the created layer
     */
    createLayer: function (layer, callback) {
        request.post(this.serverUrl + '/api/v1/layers?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: layer,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Update a layer
     * The layer object needs to contain a valid _id
     *
     * @param layer
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the updated layer
     */
    updateLayer: function (layer, callback) {
        request.put(this.serverUrl + '/api/v1/layers/' + layer._id + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: layer,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Get all connectors of a venue
     *
     * @param venueId
     * @param callback
     *  error: null or Error('message')
     *  content: the connectors
     */
    getVenueConnectors: function (venueId, callback) {
        var url = this.serverUrl + '/api/v1/connectors?organizationId=' + this.organizationId + '&api_key=' + this.apiKey + '&venueId=' + venueId;
        request.get(url, {json: true}, responseWrapper(callback));
    },

    /**
     * Delete a connector by id
     *
     * @param connectorId
     * @param callback the result callback called with one argument
     *  error: null or Error('message')
     */
    deleteConnector: function (connectorId, callback) {
        request.delete(this.serverUrl + '/api/v1/connectors/' + connectorId + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, responseWrapper(callback, 204));
    },

    /**
     * Create a connector
     * The venueId and the owner need to be specified in the connector object
     *
     * @param connector
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the created connector
     */
    createConnector: function (connector, callback) {
        request.post(this.serverUrl + '/api/v1/connectors?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: connector,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Update a connector
     * The connector object needs to contain a valid _id
     *
     * @param connector
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the updated connector
     */
    updateConnector: function (connector, callback) {
        request.put(this.serverUrl + '/api/v1/connectors/' + connector._id + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: connector,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Uploads an image to be imported for the layer
     *
     * @param layerId
     * @param imageStream the read stream with the image content
     * @param topLeft the {latitude longitude} object for the top left corner
     * @param topRight the {latitude longitude} object for the top right corner
     * @param bottomLeft the {latitude longitude} object for the bottom left corner
     * @param bottomRight the {latitude longitude} object for the bottom right corner
     * @param callback
     *  error: null or Error('message')
     */
    uploadLayerImage: function (layerId, imageStream, topLeft, topRight, bottomLeft, bottomRight, callback) {
        var formData = {
            importJob: JSON.stringify({
                corners: [
                    {lat: topLeft.latitude, lng: topLeft.longitude},
                    {lat: topRight.latitude, lng: topRight.longitude},
                    {lat: bottomLeft.latitude, lng: bottomLeft.longitude},
                    {lat: bottomRight.latitude, lng: bottomRight.longitude},
                ]
            }),
            file: {
                value: imageStream,
                options: {
                    filename: 'image.png',
                    contentType: 'image/png'
                }
            }
        };
        request.post({
            url: this.serverUrl + '/api/v1/layers/' + layerId + '/image?api_key=' + this.apiKey + '&organizationId=' + this.organizationId,
            formData: formData
        }, responseWrapper(callback));
    },

    /**
     * Get all routeGraphs of a venue
     *
     * @param venueId
     * @param callback
     *  error: null or Error('message')
     *  content: the routeGraphs
     */
    getVenueRouteGraphs: function (venueId, callback) {
        var url = this.serverUrl + '/api/v1/routegraphs?organizationId=' + this.organizationId + '&api_key=' + this.apiKey + '&venueId=' + venueId;
        request.get(url, {json: true}, responseWrapper(callback));
    },

    /**
     * Delete a routeGraph by id
     *
     * @param routeGraphId
     * @param callback the result callback called with one argument
     *  error: null or Error('message')
     */
    deleteRouteGraph: function (routeGraphId, callback) {
        request.delete(this.serverUrl + '/api/v1/routegraphs/' + routeGraphId + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, responseWrapper(callback, 204));
    },

    /**
     * Create a routeGraph
     * The venueId and the owner need to be specified in the routeGraphs object
     *
     * @param routeGraph
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the created routeGraph
     */
    createRouteGraph: function (routeGraph, callback) {
        request.post(this.serverUrl + '/api/v1/routegraphs?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: routeGraph,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Update a routeGraph
     * The routeGraph object needs to contain a valid _id
     *
     * @param routeGraph
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the updated routeGraph
     */
    updateRouteGraph: function (routeGraph, callback) {
        request.put(this.serverUrl + '/api/v1/routegraphs/' + routeGraph._id + '?api_key=' + this.apiKey + '&organizationId=' + this.organizationId, {
            body: routeGraph,
            json: true
        }, responseWrapper(callback));
    },

    /**
     * Creates or update the routeGraph for a given floor of a venue
     *
     * @param venueId
     * @param floor
     * @param routeGraph
     * @param callback the result callback called with two arguments
     *  error: null or Error('message')
     *  content: the updated routeGraph
     */
    updateRouteGraphForFloor: function (venueId, floor, routeGraph, callback) {
        var self = this;
        request.get(self.serverUrl + '/api/v1/routegraphs?organizationId=' + self.organizationId + '&api_key=' + self.apiKey + '&venueId=' + venueId + '&floor=' + floor, function (err, response, body) {
            var routeGraphs = JSON.parse(body);
            if (!err && response.statusCode == 200 && routeGraphs.length > 0) {
                request.put(self.serverUrl + '/api/v1/routegraphs/' + routeGraphs[0]._id + '?organizationId=' + self.organizationId + '&api_key=' + self.apiKey, {
                    body: routeGraph,
                    json: true
                }, responseWrapper(callback));
            } else {
                request.post(self.serverUrl + '/api/v1/routegraphs?organizationId=' + self.organizationId + '&api_key=' + self.apiKey, {
                    body: routeGraph,
                    json: true
                }, responseWrapper(callback));
            }
        });
    },

    /**
     * Returns true if both layers have equal content (_id excluded)
     *
     * @param layer1
     * @param layer2
     * @returns {boolean}
     */
    isLayerEqual: function (layer1, layer2) {
        return _.isEqual(getComparableLayer(layer1), getComparableLayer(layer2));
    },

    compareLayers: function (layer1, layer2) {
        //TODO
    },


    /**
     * Returns true if both places have equal content (_id excluded)
     *
     * @param place1
     * @param place2
     * @returns {boolean}
     */
    isPlaceEqual: function (place1, place2) {
        return _.isEqual(getComparablePlace(place1), getComparablePlace(place2));
    },

    comparePlaces: function (place1, place2) {
        //TODO
    },

    /**
     * Returns true if both placeLists have equal content (_id excluded)
     *
     * @param placeList1
     * @param placeList2
     * @returns {boolean}
     */
    isPlaceListEqual: function (placeList1, placeList2) {
        return _.isEqual(getComparablePlaceList(placeList1), getComparablePlaceList(placeList2));
    },

    comparePlaceLists: function (placeList1, placeList2) {
        //TODO
    },

    /**
     * Returns true if both connectors have equal content (_id excluded)
     *
     * @param connector1
     * @param connector2
     * @returns {boolean}
     */
    isConnectorEqual: function (connector1, connector2) {
        return _.isEqual(getComparableConnector(connector1), getComparableConnector(connector2));
    },

    compareConnector: function (connector1, connector2) {
        //TODO
    },


    /**
     * Create, update or delete all the layers on the server to match with the given list of objects.
     * The name parameter is used as index key.
     *
     * @param venueId
     * @param objects list of layers. All layers need to contain the venueId and owner parameters
     * @param options object with optional parameters
     *  filter function taking an object and returning true if the object need to be used in the sync. Only used to filter objects on server side.
     *  dryRun if true then no operation is sent to server but the number of create, update or delete is logged.
     * @param callback the result callback called with one argument
     *  error: null or Error('message')
     */
    syncVenueLayers: function (venueId, objects, options, callback) {
        syncVenueObjects('layer', 'Layer', 'Layers', this.isLayerEqual, this, venueId, objects, options, callback);
    },

    /**
     * Create, update or delete all the places on the server to match with the given list of objects.
     * The name parameter is used as index key.
     *
     * @param venueId
     * @param objects list of places. All places need to contain the venueId and owner parameters
     * @param options object with optional parameters
     *  filter function taking an object and returning true if the object need to be used in the sync. Only used to filter objects on server side.
     *  dryRun if true then no operation is sent to server but the number of create, update or delete is logged.
     * @param callback the result callback called with one argument
     *  error: null or Error('message')
     */
    syncVenuePlaces: function (venueId, objects, options, callback) {
        syncVenueObjects('place', 'Place', 'Places', this.isPlaceEqual, this, venueId, objects, options, callback);
    },

    /**
     * Create, update or delete all the placeLists on the server to match with the given list of objects.
     * The name parameter is used as index key.
     *
     * @param venueId
     * @param objects list of placeLists. All placeLists need to contain the venueId and owner parameters
     * @param options object with optional parameters
     *  filter function taking an object and returning true if the object need to be used in the sync. Only used to filter objects on server side.
     *  dryRun if true then no operation is sent to server but the number of create, update or delete is logged.
     * @param callback the result callback called with one argument
     *  error: null or Error('message')
     */
    syncVenuePlaceLists: function (venueId, objects, options, callback) {
        syncVenueObjects('placeList', 'PlaceList', 'PlaceLists', this.isPlaceListEqual, this, venueId, objects, options, callback);
    },

    /**
     * Create, update or delete all the connectors on the server to match with the given list of objects.
     * The name parameter is used as index key.
     *
     * @param venueId
     * @param objects list of connectors. All connectors need to contain the venueId and owner parameters
     * @param options object with optional parameters
     *  filter function taking an object and returning true if the object need to be used in the sync. Only used to filter objects on server side.
     *  dryRun if true then no operation is sent to server but the number of create, update or delete is logged.
     * @param callback the result callback called with one argument
     *  error: null or Error('message')
     */
    syncVenueConnectors: function (venueId, objects, options, callback) {
        syncVenueObjects('connector', 'Connector', 'Connectors', this.isConnectorEqual, this, venueId, objects, options, callback);
    }
};

