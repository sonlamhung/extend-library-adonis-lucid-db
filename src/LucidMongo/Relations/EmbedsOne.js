'use strict'

/**
 * adonis-lucid
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

const Relation = require('./Relation')
const inflect = require('inflect')
const uuid = require('uuid')
const _ = require('lodash')
const CE = require('../../Exceptions')
const CatLog = require('cat-log')
const logger = new CatLog('adonis:lucid')

class EmbedOne extends Relation {
  constructor (parent, related, primaryKey, foreignKey) {
    super(parent, related)
    this.fromKey = primaryKey || this.parent.constructor.primaryKey
    this.toKey = foreignKey || inflect.camelize(this.related.name, false)
  }

  /**
   * will eager load the relation for multiple values on related
   * model and returns an object with values grouped by foreign
   * key.
   *
   * @param {Array} values
   * @return {Object}
   *
   * @public
   *
   */
  * eagerLoad (values, scopeMethod, results) {
    if (typeof (scopeMethod) === 'function') {
      scopeMethod(this.relatedQuery)
    }

    return _(results).keyBy(this.fromKey).mapValues((value) => {
      const RelatedModel = this.related
      const modelInstance = new RelatedModel()
      modelInstance.attributes = value[this.toKey]
      modelInstance.exists = true
      modelInstance.original = _.cloneDeep(modelInstance.attributes)
      return _(modelInstance)
    }).value()
  }

  /**
   * will eager load the relation for multiple values on related
   * model and returns an object with values grouped by foreign
   * key. It is equivalent to eagerLoad but query defination
   * is little different.
   *
   * @param  {Mixed} value
   * @return {Object}
   *
   * @public
   *
   */
  * eagerLoadSingle (value, scopeMethod, result) {
    if (typeof (scopeMethod) === 'function') {
      scopeMethod(this.relatedQuery)
    }
    const response = {}
    const RelatedModel = this.related
    const modelInstance = new RelatedModel()
    modelInstance.attributes = result[this.toKey]
    modelInstance.exists = true
    modelInstance.original = _.cloneDeep(modelInstance.attributes)
    response[value] = _(modelInstance)
    return response
  }

  /**
   * Save related instance
   *
   * @param {any} relatedInstance
   * @returns
   *
   * @memberOf EmbedOne
   */
  * save (relatedInstance) {
    if (relatedInstance instanceof this.related === false) {
      throw CE.ModelRelationException.relationMisMatch('save accepts an instance of related model')
    }
    if (this.parent.isNew()) {
      throw CE.ModelRelationException.unSavedTarget('save', this.parent.constructor.name, this.related.name)
    }
    if (!this.parent[this.fromKey]) {
      logger.warn(`Trying to save relationship with ${this.fromKey} as primaryKey, whose value is falsy`)
    }
    if (!relatedInstance[this.fromKey]) {
      relatedInstance[this.fromKey] = uuid.v4()
    }
    this.parent.set(this.toKey, relatedInstance.toJSON())
    yield this.parent.save()
    return relatedInstance
  }

  /**
   * Delete related instance
   *
   * @param {any} relatedInstance
   * @returns
   *
   * @memberOf EmbedOne
   */
  * delete () {
    if (this.parent.isNew()) {
      throw CE.ModelRelationException.unSavedTarget('delete', this.parent.constructor.name, this.related.name)
    }

    this.parent.unset(this.toKey)
    return yield this.parent.save()
  }
}

module.exports = EmbedOne
