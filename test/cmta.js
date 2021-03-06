'use strict'

const assert = require('assert')
const tapePromise = require('tape-promise').default
const tape = require('tape')

const {createWhen} = require('./lib/util')
const co = require('./lib/co')
const createClient = require('..')
const cmtaProfile = require('../p/cmta')
const products = require('../p/cmta/products')
const {movement: _validateMovement} = require('./lib/validators')
const createValidate = require('./lib/validate-fptf-with')
const testJourneysStationToStation = require('./lib/journeys-station-to-station')
const testJourneysStationToAddress = require('./lib/journeys-station-to-address')
const testJourneysStationToPoi = require('./lib/journeys-station-to-poi')
const testEarlierLaterJourneys = require('./lib/earlier-later-journeys')
const testRefreshJourney = require('./lib/refresh-journey')
const journeysFailsWithNoProduct = require('./lib/journeys-fails-with-no-product')
const testDepartures = require('./lib/departures')
const testArrivals = require('./lib/arrivals')
const testJourneysWithDetour = require('./lib/journeys-with-detour')
const testReachableFrom = require('./lib/reachable-from')

const when = createWhen(cmtaProfile.timezone, cmtaProfile.locale)

const cfg = {
	when,
	stationCoordsOptional: false,
	products
}

const validateMovement = (val, m, name = 'movement') => {
	// todo: fix this upstream
	const withFakeLocation = Object.assign({}, m)
	withFakeLocation.location = Object.assign({}, m.location, {
		latitude: 50,
		longitude: 12
	})
	_validateMovement(val, withFakeLocation, name)

	assert.ok(m.location.latitude <= 33, name + '.location.latitude is too small')
	assert.ok(m.location.latitude >= 26, name + '.location.latitude is too large')
	assert.ok(m.location.longitude >= -100, name + '.location.longitude is too small')
	assert.ok(m.location.longitude <= -95, name + '.location.longitude is too small')
}

const validate = createValidate(cfg, {
	movement: validateMovement
})

const test = tapePromise(tape)
const client = createClient(cmtaProfile, 'public-transport/hafas-client:test')

const broadieOaks = '2370'
const domain = '5919'
const capitol591 = '591'

test('journeys – Broadie Oaks to Domain', co(function* (t) {
	const journeys = yield client.journeys(broadieOaks, domain, {
		results: 3,
		departure: when,
		stopovers: true
	})

	yield testJourneysStationToStation({
		test: t,
		journeys,
		validate,
		fromId: broadieOaks,
		toId: domain
	})
	t.end()
}))

// todo: journeys, only one product

test('journeys – fails with no product', (t) => {
	journeysFailsWithNoProduct({
		test: t,
		fetchJourneys: client.journeys,
		fromId: broadieOaks,
		toId: domain,
		when,
		products
	})
	t.end()
})

test('Domain to 1104 Elm Street, Austin, TX 78703', co(function*(t) {
	const someAddress = {
		type: 'location',
		address: '1104 ELM ST, Austin, TX 78703',
		latitude: 30.279220,
		longitude: -97.758292
	}

	const journeys = yield client.journeys(domain, someAddress, {
		results: 3,
		departure: when
	})

	yield testJourneysStationToAddress({
		test: t,
		journeys,
		validate,
		fromId: domain,
		to: someAddress
	})
	t.end()
}))

test('Domain to Whole Foods Market - North Lamar Blvd', co(function*(t) {
	const wholeFoodsMarket = {
		type: 'location',
		id: '9845477',
		name: 'Whole Foods Market - N Lamar Blvd',
		latitude: 30.270653,
		longitude: -97.753564
	}
	const journeys = yield client.journeys(domain, wholeFoodsMarket, {
		results: 3,
		departure: when
	})

	yield testJourneysStationToPoi({
		test: t,
		journeys,
		validate,
		fromId: domain,
		to: wholeFoodsMarket
	})
	t.end()
}))

// todo: via works – with detour
// todo: without detour

test('earlier/later journeys', co(function* (t) {
	yield testEarlierLaterJourneys({
		test: t,
		fetchJourneys: client.journeys,
		validate,
		fromId: broadieOaks,
		toId: domain
	})

	t.end()
}))

test('refreshJourney', co(function* (t) {
	yield testRefreshJourney({
		test: t,
		fetchJourneys: client.journeys,
		refreshJourney: client.refreshJourney,
		validate,
		fromId: broadieOaks,
		toId: domain,
		when
	})
	t.end()
}))

test('trip details', co(function* (t) {
	const journeys = yield client.journeys(broadieOaks, domain, {
		results: 1, departure: when
	})

	const p = journeys[0].legs[0]
	t.ok(p.id, 'precondition failed')
	t.ok(p.line.name, 'precondition failed')
	const trip = yield client.trip(p.id, p.line.name, {when})

	validate(t, trip, 'journeyLeg', 'trip')
	t.end()
}))

test('departures at Broadie Oaks', co(function*(t) {
	const departures = yield client.departures(broadieOaks, {
		duration: 10, when
	})

	yield testDepartures({
		test: t,
		departures,
		validate,
		id: broadieOaks
	})
	t.end()
}))

test('departures with station object', co(function* (t) {
	const deps = yield client.departures({
		type: 'station',
		id: broadieOaks,
		name: 'Magdeburg Hbf',
		location: {
			type: 'location',
			latitude: 1.23,
			longitude: 2.34
		}
	}, {when})

	validate(t, deps, 'departures', 'departures')
	t.end()
}))

test('arrivals at Broadie Oaks', co(function*(t) {
	const arrivals = yield client.arrivals(broadieOaks, {
		duration: 10, when
	})

	yield testArrivals({
		test: t,
		arrivals,
		validate,
		id: broadieOaks
	})
	t.end()
}))

// todo: nearby

test('locations named "Capitol"', co(function*(t) {
	const locations = yield client.locations('Capitol', {
		results: 10
	})

	validate(t, locations, 'locations', 'locations')
	t.ok(locations.length <= 10)

	t.ok(locations.find(s => s.type === 'stop' || s.type === 'station'))
	t.ok(locations.find(s => s.id && s.name)) // POIs
	t.ok(locations.some((l) => {
		const trim = str => str && str.replace(/^0+/, '')
		return l.station && trim(l.station.id) === capitol591 || trim(l.id) === capitol591
	}))

	t.end()
}))

test('station Domain', co(function* (t) {
	const s = yield client.station(domain)

	validate(t, s, ['stop', 'station'], 'station')
	t.equal(s.id, domain)

	t.end()
}))

test('radar', co(function* (t) {
	const vehicles = yield client.radar({
		north: 30.240877,
		west: -97.804588,
		south: 30.225378,
		east: -97.786692
	}, {
		duration: 5 * 60, when, results: 10
	})

	validate(t, vehicles, 'movements', 'vehicles')
	t.end()
}))

test('reachableFrom', co(function* (t) {
	yield testReachableFrom({
		test: t,
		reachableFrom: client.reachableFrom,
		address: {
			type: 'location',
			address: '604 W 9TH ST, Austin, TX 78701',
			latitude: 30.272910,
			longitude: -97.747883
		},
		when,
		maxDuration: 15,
		validate
	})
	t.end()
}))
