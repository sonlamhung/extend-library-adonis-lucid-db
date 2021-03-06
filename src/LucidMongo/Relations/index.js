'use strict'

/**
 * adonis-lucid
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

module.exports = {
  BelongsTo: require('./BelongsTo'),
  BelongsToMany: require('./BelongsToMany'),
  HasMany: require('./HasMany'),
  HasManyThrough: require('./HasManyThrough'),
  HasOne: require('./HasOne'),
  MorphMany: require('./MorphMany'),
  MorphTo: require('./MorphTo'),
  MorphOne: require('./MorphOne'),
  EmbedsOne: require('./EmbedsOne'),
  EmbedsMany: require('./EmbedsMany'),
  ReferMany: require('./ReferMany'),
  EagerLoad: require('./EagerLoad')
}
