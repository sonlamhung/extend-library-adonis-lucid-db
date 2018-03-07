'use strict'

/**
 * adonis-lucid
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

/**
 * to have scollection support for proxies
 * we need harmony-reflect
 */
require('harmony-reflect')

const MongoClient = require('mongodb').MongoClient
const mquery = require('mquery')
const util = require('../../lib/util')
const co = require('co')
const CE = require('../Exceptions')
const _ = require('lodash')

/**
 * Database provider to build sql queries
 * @module Database
 */
const Database = {}

/**
 * here we store connection pools, created by database provider. It is
 * required to re-use old connections as database provider has support
 * for using multiple connections on runtime, and spwaning a new
 * connection everytime will blow up things.
 *
 *
 * @type {Object}
 *
 * @private
 */
let connectionPools = {}

/**
 * reference to config provider, since we do
 * not require providers and instead get
 * them from IOC container.
 *
 * @type {Object}
 *
 * @private
 */
let ConfigProvider = {}

/**
 * emits sql event on query builder instance with
 * formatted sql statement and time taken by a
 * given query.
 *
 * @method emitSql
 *
 * @param  {Object} query
 *
 * @private
 */
// const _emitSql = function (builder) {
//   const hrstart = process.hrtime()
//   builder.once('query', (query) => {
//     const sql = this.client._formatQuery(query.sql, query.bindings, query.tz)
//     builder.once('end', () => {
//       this.emit('sql', `+ ${util.timeDiff(hrstart)} : ${sql}`)
//     })
//   })
// }

/**
 * Following attributes should be removed from the
 * paginate count query since things like orderBy
 * is not required when fetching the count.
 *
 * @type {Array}
 */
const excludeAttrFromCount = ['order']

/**
 * sets the config provider for database module
 * It is set while registering it inside the
 * IOC container. So no one will ever to
 * deal with it manaully.
 *
 * @method _setConfigProvider.
 *
 * @param  {Object}           Config
 *
 * @private
 */
Database._setConfigProvider = function (Config) {
  ConfigProvider = Config
}

/**
 * Resolves a connection key to be used for fetching database
 * connection config. If key is defined to default, it
 * will make use the value defined next to
 * database.connection key.
 *
 * @method _resolveConnectionKey
 *
 * @param  {String}  connection
 * @return {Object}
 *
 * @private
 */
Database._resolveConnectionKey = function (connection) {
  if (connection === 'default') {
    connection = ConfigProvider.get('database.connection')
    if (!connection) {
      throw CE.InvalidArgumentException.missingConfig('Make sure to define a connection inside the database config file')
    }
  }
  return connection
}

/**
 * returns MongoClient instance for a given connection if it
 * does not exists, a pool is created and returned.
 *
 * @method connection
 *
 * @param  {String}      connection
 * @return {Object}
 *
 * @example
 * Database.connection('mysql')
 * Database.connection('sqlite')
 */
Database.connection = function (connection) {
  connection = Database._resolveConnectionKey(connection)
  return new Promise(function (resolve, reject) {
    if (!connectionPools[connection]) {
      const config = ConfigProvider.get(`database.${connection}`)
      if (!config) {
        throw CE.InvalidArgumentException.missingConfig(`Unable to get database client configuration for ${connection}`)
      }
      const security = (process.env.DB_USER && process.env.DB_PASSWORD)
        ? `${process.env.DB_USER}:${process.env.DB_PASSWORD}@`
        : (process.env.DB_USER ? `${process.env.DB_USER}@` : '')

      const authString = (config.connection.auth && config.connection.auth.source && config.connection.auth.mechanism)
        ? `?authSource=${config.connection.auth.source}&authMechanism=${config.connection.auth.mechanism}`
        : ''

      const connectionString = `mongodb://${security}${config.connection.host}:${config.connection.port}/${config.connection.database}${authString}`
      MongoClient.connect(connectionString).then(dbConnection => {
        connectionPools[connection] = dbConnection
        resolve(connectionPools[connection])
      })
    } else {
      resolve(connectionPools[connection])
    }
  })
}

/**
 * returns list of connection pools created
 * so far.
 *
 * @method getConnectionPools
 *
 * @return {Object}
 * @public
 */
Database.getConnectionPools = function () {
  return connectionPools
}

/**
 * closes database connection by destroying the client
 * and remove it from the pool.
 *
 * @method close
 *
 * @param {String} [connection] name of the connection to close, if not provided
 *                               all connections will get closed.
 * @return {void}
 *
 * @public
 */
Database.close = function (connection) {
  connection = connection ? Database._resolveConnectionKey(connection) : null
  if (connection && connectionPools[connection]) {
    connectionPools[connection].close()
    delete connectionPools[connection]
    return
  }

  _.each(connectionPools, (pool) => {
    pool.close()
  })
  connectionPools = {}
}

/**
 * beginTransaction is used for doing manual commit and
 * rollback. Errors emitted from this method are voided.
 *
 * @method beginTransaction
 *
 * @param  {Function}    clientTransaction original transaction method from MongoClient instance
 * @return {Function}
 *
 * @example
 * const trx = yield Database.beginTransaction()
 * yield Database.collection('users').transacting(trx)
 * trx.commit()
 * trx.rollback()
 *
 * @public
 */
Database.beginTransaction = function (clientTransaction) {
  return function () {
    return new Promise(function (resolve, reject) {
      clientTransaction(function (trx) {
        resolve(trx)
      })
        .catch(function () {
          /**
           * adding a dummy handler to avoid exceptions from getting thrown
           * as this method does not need a handler
           */
        })
    })
  }
}

/**
 * overrides the actual transaction method on MongoClient
 * to have a transaction method with support for
 * generator methods
 * @method transaction
 * @param  {Function}    clientTransaction original transaction method from MongoClient instance
 * @return {Function}
 *
 * @example
 * Database.transaction(function * (trx) {
 *   yield trx.collection('users')
 * })
 *
 * @public
 */
Database.transaction = function (clientTransaction) {
  return function (cb) {
    return clientTransaction(function (trx) {
      co(function * () {
        return yield cb(trx)
      })
        .then(trx.commit)
        .catch(trx.rollback)
    })
  }
}

/**
 * sets offset and limit on query chain using
 * current page and perpage params
 *
 * @method forPage
 *
 * @param  {Number} page
 * @param  {Number} [perPage=20]
 * @return {Object}
 *
 * @example
 * Database.collection('users').forPage(1)
 * Database.collection('users').forPage(1, 30)
 *
 * @public
 */
Database.forPage = function (page, perPage) {
  util.validatePage(page)
  perPage = perPage || 20
  const offset = util.returnOffset(page, perPage)
  return this.skip(offset).limit(perPage).find()
}

/**
 * gives paginated results for a given
 * query.
 *
 * @method paginate
 *
 * @param  {Number} page
 * @param  {Number} [perPage=20]
 * @param  {Object} [countByQuery]
 * @return {Array}
 *
 * @example
 * Database.collection('users').paginate(1)
 * Database.collection('users').paginate(1, 30)
 *
 * @public
 */
Database.paginate = function * (page, perPage, countByQuery) {
  const parsedPerPage = _.toSafeInteger(perPage) || 20
  const parsedPage = _.toSafeInteger(page)
  util.validatePage(parsedPage)
  /**
   * first we count the total rows before making the actual
   * query for getting results
   */
  countByQuery = countByQuery || _.clone(this).count()

  /**
   * Filter unnecessary statements from the cloned query
   */
  countByQuery._statements = _.filter(countByQuery._statements, (statement) => excludeAttrFromCount.indexOf(statement.grouping) < 0)

  const count = yield countByQuery

  if (!count || parseInt(count, 10) === 0) {
    return util.makePaginateMeta(0, parsedPage, parsedPerPage)
  }

  /**
   * here we fetch results and set meta data for paginated
   * results
   */
  const results = yield this.forPage(parsedPage, parsedPerPage)
  const resultSet = util.makePaginateMeta(parseInt(count, 10), parsedPage, parsedPerPage)
  resultSet.data = results
  return resultSet
}

/**
 * returns chunk of data under a defined limit of results, and
 * invokes a callback, everytime there are results.
 *
 * @method *chunk
 *
 * @param  {Number}   limit
 * @param  {Function} cb
 * @param  {Number}   [page=1]
 *
 * @example
 * Database.collection('users').chunk(200, function (users) {
 *
 * })
 *
 * @public
 */
Database.chunk = function * (limit, cb, page) {
  page = page || 1
  const result = yield this.forPage(page, limit)
  if (result.length) {
    cb(result)
    page++
    yield this.chunk(limit, cb, page)
  }
}

/**
 * Overriding the orginal MongoClient.collection method to prefix
 * the collection name based upon the prefix option
 * defined in the config
 *
 * @param  {String} collectionName
 *
 * @return {Object}
 */
Database.collection = function (collectionName) {
  const prefix = this._instancePrefix || this.client.config.prefix
  const prefixedCollectionName = (prefix && !this._skipPrefix) ? `${prefix}${collectionName}` : collectionName
  this._originalCollection(prefixedCollectionName)
  return this
}

/**
 * Skipping the prefix for a single query
 *
 * @return {Object}
 */
Database.withoutPrefix = function () {
  this._skipPrefix = true
  return this
}

/**
 * Changing the prefix for a given query
 *
 * @param  {String} prefix
 *
 * @return {Object}
 */
Database.withPrefix = function (prefix) {
  this._instancePrefix = prefix
  return this
}

Database.pluckAll = function (fields) {
  const args = _.isArray(fields) ? fields : _.toArray(arguments)
  return this.select.apply(this, args)
}

Database.schema = {
  createCollection: function * (collectionName, callback) {
    const db = yield Database.connection('default')
    const collection = yield db.createCollection(collectionName)
    const schemaBuilder = new SchemaBuilder(collection)
    callback(schemaBuilder)
    return yield schemaBuilder.build()
  },

  createCollectionIfNotExists: function * (collectionName, callback) {
    const db = yield Database.connection('default')
    const collection = yield db.createCollection(collectionName)
    const schemaBuilder = new SchemaBuilder(collection)
    callback(schemaBuilder)
    return yield schemaBuilder.build()
  },

  dropCollection: function * (collectionName) {
    const db = yield Database.connection('default')
    return yield db.dropCollection(collectionName)
  },

  dropIfExists: function * (collectionName) {
    const db = yield Database.connection('default')
    return yield db.dropCollection(collectionName)
  },

  renameCollection: function * (collectionName, target) {
    const db = yield Database.connection('default')
    return yield db.collection(collectionName).rename(target)
  }
}

function SchemaBuilder (collection) {
  this.collection = collection
  this.createIndexes = []
  this.dropIndexes = []

  this.increments = function () {}
  this.timestamps = function () {}
  this.softDeletes = function () {}
  this.string = function () {}
  this.timestamp = function () {}
  this.boolean = function () {}
  this.integer = function () {}
  this.double = function () {}
  this.index = function (name, keys, options) {
    if (!name) {
      throw new CE.InvalidArgumentException(`param name is required to create index`)
    }
    if (!keys || !_.size(keys)) {
      throw new CE.InvalidArgumentException(`param keys is required to create index`)
    }
    options = options || {}
    options['name'] = name
    this.createIndexes.push({keys, options})
  }
  this.dropIndex = function (name) {
    this.dropIndexes.push(name)
  }
  this.build = function * () {
    for (var i in this.createIndexes) {
      var createIndex = this.createIndexes[i]
      yield this.collection.createIndex(createIndex.keys, createIndex.options)
    }
    for (var j in this.dropIndexes) {
      var dropIndex = this.dropIndexes[j]
      yield this.collection.dropIndex(dropIndex.keys, dropIndex.options)
    }
  }
}

/**
 * these methods are not proxied and instead actual implementations
 * are returned
 *
 * @type {Array}
 *
 * @private
 */
const customImplementations = ['_resolveConnectionKey', '_setConfigProvider', 'getConnectionPools', 'connection', 'close', 'schema']

mquery.prototype.forPage = Database.forPage
mquery.prototype.paginate = Database.paginate
mquery.prototype.chunk = Database.chunk
mquery.prototype._originalCollection = mquery.prototype.dbCollection
mquery.prototype.dbCollection = Database.collection
mquery.prototype.from = Database.collection
mquery.prototype.into = Database.collection
mquery.prototype.withPrefix = Database.withPrefix
mquery.prototype.withoutPrefix = Database.withoutPrefix
mquery.prototype.pluckAll = Database.pluckAll

/**
 * Proxy handler to proxy methods and send
 * them to MongoClient directly.
 *
 * @type {Object}
 *
 * @private
 */
const DatabaseProxy = {
  get: function (target, name) {
    if (customImplementations.indexOf(name) > -1) {
      return target[name]
    }
    return Database.connection('default')[name]
  }
}

module.exports = new Proxy(Database, DatabaseProxy)
