'use strict'

/**
 * adonis-lucid
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

const ServiceProvider = require('adonis-fold').ServiceProvider

class DatabaseMysqlProvider extends ServiceProvider {
  * register () {
    this.app.bind('Adonis/Src/DatabaseMysql', function (app) {
      const Database = require('../src/DatabaseMysql')
      Database._setConfigProvider(app.use('Adonis/Src/Config'))
      return Database
    })
  }
}
module.exports = DatabaseMysqlProvider
