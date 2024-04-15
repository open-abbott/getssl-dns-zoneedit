#!/usr/bin/env node
'use strict'

import extend from 'extend'
import { close, open, readFile, stat, writeFile } from 'node:fs'
import https from 'https'
import md5 from 'md5'
import { parse as parseHtml } from 'node-html-parser'
import { Cookie, CookieJar, MemoryCookieStore } from 'tough-cookie'
import { promisify } from 'util'

const state = {
    domain: '', // defined later
    user: process.env.ZONEEDIT_USER,
    pass: process.env.ZONEEDIT_PASS,
    token: process.env.ZONEEDIT_TOKEN,
    txtHost: '', // defined later
    txtValue: '' // defined later
}

const UserAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36'

const HttpMethod = {
    GET: 'GET',
    POST: 'POST'
}

const HttpHeader = {
    Accept: 'Accept',
    AcceptEncoding: 'Accept-Encoding',
    AcceptLanguage: 'Accept-Language',
    CacheControl: 'Cache-Control',
    Connection: 'Connection',
    ContentLength: 'Content-Length',
    ContentType: 'Content-Type',
    Host: 'Host',
    Location: 'Location',
    Origin: 'Origin',
    Pragma: 'Pragma',
    Referer: 'Referer',
    SecFetchDest: 'Sec-Fetch-Dest',
    SecFetchMode: 'Sec-Fetch-Mode',
    SecFetchSite: 'Sec-Fetch-Site',
    SecFetchUser: 'Sec-Fetch-User',
    SecGpc: 'Sec-GPC',
    SetCookie: 'set-cookie',
    TransferEncoding: 'Transfer-Encoding',
    UpgradeInsecureRequests: 'Upgrade-Insecure-Requests',
    UserAgent: 'User-Agent',
    XRequestedWith: 'X-Requested-With'
}

const ContentType = {
    ApplicationJson: 'application/json',
    TextHtml: 'text/html',
    WwwForm: 'application/x-www-form-urlencoded',
    Wildcard: '*/*'
}

function objectToFormPayload(obj) {
    return Object.keys(obj).map(k => {
        return `${encodeURIComponent(k)}=${encodeURIComponent(obj[k])}`
    }).join('&')
}

class HttpClient {
    constructor() {
        this.store = new MemoryCookieStore()
        this.cookieJar = new CookieJar(this.store, {
            looseMode: true
        })
    }
    parseCookie(setCookieHeader) {
        return Cookie.parse(setCookieHeader, {
            loose: true
        })
    }
    setCookie(cookie, url) {
        this.cookieJar.setCookieSync(cookie, url)
    }
    cookiesToJson() {
        return this.cookieJar.serializeSync()
    }
    cookiesFromJson(json) {
        return this.cookieJar = CookieJar.deserializeSync(json, this.store)
    }
    request(options, callback) {
        const url = `https://${options.host}${options.path}`
        extend(true, options, {
            headers: {
                Cookie: this.cookieJar.getCookieStringSync(url),
                [HttpHeader.UserAgent]: UserAgent
            }
        })
        const r = https.request(options, response => {
            console.log(`${response.statusCode} ${options.method} ${url}`)
            response.on('end', () => {
                const cookieData = response.headers[HttpHeader.SetCookie]
                if (Array.isArray(cookieData)) {
                    cookieData.forEach(h => {
                        const c = this.parseCookie(h)
                        this.setCookie(c, url)
                    })
                }
                else if (cookieData) {
                    const c = this.parseCookie(cookieData)
                    this.setCookie(c, url)
                }
            })
            callback(response)
        })
        return r
    }
}

function getLoginForm(client, callback) {
    const r = client.request({
        method: HttpMethod.GET,
        host: 'cp.zoneedit.com',
        path: '/login.php'
    }, response => {
        let body = ""

        response.on('data', d => {
            body += d.toString()
        })

        response.on('end', () => {
            if (200 !== response.statusCode) {
                return callback(new Error('Failed to get login form'))
            }
            const form = {}
            const document = parseHtml(body)
            const formElements = [ 'login_chal', 'csrf_token' ]
            formElements.forEach(n => {
                const value = document
                    .querySelector(`form input[name="${n}"]`)
                    .getAttribute('value')
                form[n] = value
            })
            callback(null, form)
        })
    })

    r.on('error', err => callback(err))
    r.end()
}

function performLogin(client, form, callback) {
    const payload = objectToFormPayload(form)
    const r = client.request({
        method: HttpMethod.POST,
        host: 'cp.zoneedit.com',
        path: '/home/',
        headers: {
            [HttpHeader.Accept]: ContentType.Wildcard,
            [HttpHeader.ContentLength]: Buffer.byteLength(payload),
            [HttpHeader.ContentType]: ContentType.WwwForm
        }
    }, response => {
        if (302 !== response.statusCode) {
            return callback(new Error('Login did not redirect'))
        }
        let body = ""

        response.on('data', d => {
            body += d.toString()
        })

        response.on('end', () => {
            callback(null, client)
        })
    })

    r.on('error', err => callback(err))
    r.write(payload)
    r.end()
}

function getTwoFactorForm(client, callback) {
        const r = client.request({
        method: HttpMethod.GET,
        host: 'cp.zoneedit.com',
        path: '/tfa.php'
    }, response => {
        let body = ""

        response.on('data', d => {
            body += d.toString()
        })

        response.on('end', () => {
            if (200 !== response.statusCode) {
                console.warn(`${response.statusCode} ${response.statusMessage}`)
                return callback(new Error('Failed to get two factor code form'))
            }
            const form = {}
            const document = parseHtml(body)
            const formElements = [ 'csrf_token' ]
            formElements.forEach(n => {
                const value = document
                    .querySelector(`form input[name="${n}"]`)
                    .getAttribute('value')
                form[n] = value
            })
            callback(null, form)
        })
    })

    r.on('error', err => callback(err))
    r.end()
}

function performTwoFactorAuth(client, form, callback) {
    const payload = objectToFormPayload(form)
    const r = client.request({
        method: HttpMethod.POST,
        host: 'cp.zoneedit.com',
        path: '/tfa.php',
        headers: {
            [HttpHeader.Accept]: ContentType.Wildcard,
            [HttpHeader.ContentLength]: Buffer.byteLength(payload),
            [HttpHeader.ContentType]: ContentType.WwwForm
        }
    }, response => {
        if (200 !== response.statusCode && 302 !== response.statusCode) {
            console.warn(`${response.statusCode} ${response.statusMessage}`)
            return callback(new Error('Second factor did not succeed'))
        }
        let body = ""

        response.on('data', d => {
            body += d.toString()
        })

        response.on('end', () => {
            callback(null, client)
        })
    })

    r.on('error', err => callback(err))
    r.write(payload)
    r.end()
}

function twoFactorAuth(client, callback) {
    getTwoFactorForm(client, (err, form) => {
        if (err) {
            return callback(err)
        }
        try {
            form.mode = 'token'
            form['auto-submit'] = '1'
            form.token = state.token
            form.forceReload = '0'
            performTwoFactorAuth(client, form, callback)
        }
        catch (error) {
            callback(new Error('Failed handling two factor form', { cause: error }))
        }
    })
}

function login(client, callback) {
    getLoginForm(client, (err, form) => {
        if (err) {
            return callback(new Error('Failed getting login form', { cause: err }))
        }
        try {
            form.login_user = state.user
            form.login_pass = state.pass
            form.login_hash = md5([
                form.login_user,
                md5(form.login_pass),
                form.login_chal
            ].join(""))
            performLogin(client, form, (err, client) => {
                if (err) {
                    return callback(new Error('Failed performing login', { cause: err }))
                }
                twoFactorAuth(client, callback)
            })
        }
        catch (error) {
            console.warn(error.stack)
            callback(new Error('Failed handling login form', { cause: error }))
        }
    })
}

const cookieCache = '/tmp/getssl-dns-zoneedit-cookie-cache'
const cacheMaxAgeMinutes = 30

function loginAndSaveCookies(client, callback) {
    try {
        login(client, (err, client) => {
            if (err) {
                return callback(err)
            }
            const writeOptions = {
                encoding: 'utf8',
                flag: 'w'
            }
            writeFile(cookieCache, JSON.stringify(client.cookiesToJson()), writeOptions, err => {
                if (err) {
                    return callback(err)
                }
                callback(null, client)
            })
        })
    }
    catch (error) {
        callback(error)
    }
}

function cacheIsOk(callback) {
    try {
        stat(cookieCache, (err, stats) => {
            if (err) {
                return callback(err)
            }
            const threshold = new Date()
            threshold.setMinutes(threshold.getMinutes() - cacheMaxAgeMinutes)
            callback(null, stats.ctime > threshold)
        })
    }
    catch (error) {
        callback(error)
    }
}

function prepareClient(client, callback) {
    try {
        open(cookieCache, 'r', (err, fd) => {
            if (err && 'ENOENT' === err.code) {
                loginAndSaveCookies(client, callback)
            }
            else if (err) {
                callback(err)
            }
            else {
                cacheIsOk((err, cacheOk) => {
                    if (err) {
                        return callback(err)
                    }
                    if (cacheOk) {
                        const readOptions = {
                            encoding: 'utf8'
                        }
                        readFile(fd, readOptions, (err, data) => {
                            if (err) {
                                return callback(err)
                            }
                            client.cookiesFromJson(JSON.parse(data))
                            close(fd, err => {
                                if (err) {
                                    return callback(new Error('Failed to close cache', { cause: err }))
                                }
                                callback(null, client)
                            })
                        })
                    }
                    else {
                        close(fd, err => {
                            if (err) {
                                return callback(new Error('Failed to close cache', { cause: err }))
                            }
                            loginAndSaveCookies(client, callback)
                        })
                    }
                })
            }
        })
    }
    catch (error) {
        callback(new Error('Failed to read cookie cache', { cause: error }))
    }
}

function loginToDomain(client, callback) {
    const r = client.request({
        method: HttpMethod.GET,
        host: 'cp.zoneedit.com',
        path: `/manage/domains/?LOGIN=${state.baseDomain}`
    }, response => {
        let body = ""

        response.on('data', d => {
            body += d.toString()
        })

        response.on('end', () => {
            callback(null, client)
        })
    })

    r.on('error', err => callback(err))
    r.end()
}

function interrogateRecordsTxt(client, callback) {
    const r = client.request({
        method: HttpMethod.GET,
        host: 'cp.zoneedit.com',
        path: '/manage/domains/txt/edit.php'
    }, response => {
        let body = ""

        response.on('data', d => {
            body += d.toString()
        })

        response.on('end', () => {
            if (200 !== response.statusCode) {
                console.log(response.headers)
                return callback(new Error('Failed to retrieve TXT records'))
            }

            const document = parseHtml(body)
            const form = document
                .querySelectorAll('form input')
                .map(node => {
                    return {
                        [node.getAttribute('name')]: node.getAttribute('value')
                    }
                })
                .reduce((a, m) => {
                    return extend(true, a, m)
                }, {})

            callback(null, form)
        })
    })

    r.on('error', err => callback(err))
    r.end()
}

function extractRecordsFromForm(form) {
    const records = []
    Object.keys(form)
        .filter(k => k.match('^TXT::'))
        .forEach(k => {
            const a = k.split('::')
            if (!(a[1] in records)) {
                records[a[1]] = {}
            }
            records[a[1]][a[2]] = form[k]
            delete form[k]
        })
    return records
}

function addTxtRecord(form) {
    const records = extractRecordsFromForm(form)

    console.log('addTxtRecord: starting form')
    console.log(form)

    const existingRecord = records.find(r => r.host === state.txtHost)
    if (existingRecord) {
        existingRecord.txt = state.txtValue
    }
    else {
        records.push({
            host: state.txtHost,
            txt: state.txtValue,
            ttl: ''
        })
    }

    records.forEach((r, i) => {
        // this field is unnecessary for create
        delete r.del
        Object.keys(r).forEach(k => {
            form[`TXT::${i}::${k}`] = r[k]
        })
    })

    // ???
    form.next = ''

    console.log('addTxtRecord: ending form')
    console.log(form)

    return form
}

function delTxtRecord(form) {
    const records = extractRecordsFromForm(form)

    records.forEach((r, i) => {
        if (state.txtHost === r.host) {
            r.del = 1
        }
        else {
            delete r.del
        }
        Object.keys(r).forEach(k => {
            form[`TXT::${i}::${k}`] = r[k]
        })
    })

    // ???
    form.next = ''

    return form
}

function confirmRecordsTxt(client, form, callback) {
    const payload = objectToFormPayload(form)
    const r = client.request({
        method: HttpMethod.POST,
        host: 'cp.zoneedit.com',
        path: '/manage/domains/txt/confirm.php',
        headers: {
            [HttpHeader.Accept]: ContentType.Wildcard,
            [HttpHeader.ContentLength]: Buffer.byteLength(payload),
            [HttpHeader.ContentType]: ContentType.WwwForm
        }
    }, response => {
        let body = ""

        response.on('data', d => {
            body += d.toString()
        })

        response.on('end', () => {
            if (200 !== response.statusCode) {
                console.log(response.headers)
                console.log(body)
                return callback(new Error('Failed to confirm TXT records'))
            }

            callback(null, client)
        })
    })

    r.on('error', err => callback(err))
    r.write(payload)
    r.end()
}

function updateRecordsTxt(client, form, transform, callback) {
    transform(form)

    const payload = objectToFormPayload(form)
    const r = client.request({
        method: HttpMethod.POST,
        host: 'cp.zoneedit.com',
        path: '/manage/domains/txt/edit.php',
        headers: {
            [HttpHeader.Accept]: ContentType.Wildcard,
            [HttpHeader.ContentLength]: Buffer.byteLength(payload),
            [HttpHeader.ContentType]: ContentType.WwwForm
        }
    }, response => {
        let body = ""

        response.on('data', d => {
            body += d.toString()
        })

        response.on('end', () => {
            if (200 !== response.statusCode) {
                return callback(new Error('Failed to update TXT records'))
            }
            const document = parseHtml(body)
            const form = document
                .querySelectorAll('input')
                .map(node => {
                    return {
                        [node.getAttribute('name')]: node.getAttribute('value')
                    }
                })
                .reduce((a, m) => {
                    return extend(true, a, m)
                }, {})

            // ???
            form.confirm = ''

            confirmRecordsTxt(client, form, callback)
        })
    })

    r.on('error', err => callback(err))
    r.write(payload)
    r.end()
}

function addRecordsTxt(client, form, callback) {
    updateRecordsTxt(client, form, addTxtRecord, callback)
}

function delRecordsTxt(client, form, callback) {
    updateRecordsTxt(client, form, delTxtRecord, callback)
}

const [ cmd, domain, txtValue ] = process.argv.slice(2)

if (!['add', 'del'].find(c => c === cmd)) {
    console.error(`Command not available: ${cmd}`)
    process.exit(-1)
}

try {
    const domainArray = domain.split('.')
    state.domain = domain
    state.baseDomain = domainArray.slice(-2).join('.')

    domainArray.unshift('_acme-challenge')
    state.txtHost = domainArray.slice(0, domainArray.length - 2).join('.')
    state.txtValue = txtValue
}
catch (error) {
    console.error(`Unable to parse domain argument: ${domain}`)
    console.error(error)
    process.exit(-1)
}

if ('add' === cmd && ('string' !== typeof txtValue || 0 === txtValue.length)) {
    console.error('Invalid value specified for TXT record value')
    process.exit(-1)
}

if (undefined === state.user) {
    console.error('No value specified for ZONEEDIT_USER environment variable')
    process.exit(-1)
}
if (undefined === state.pass) {
    console.error('No value specified for ZONEEDIT_PASS environment variable')
    process.exit(-1)
}

console.log(`Working with domain: ${state.domain}`)
console.log(`TXT record value: ${state.txtValue}`)

const client = new HttpClient()
promisify(prepareClient)(client)
    .then(_ => {
        return promisify(loginToDomain)(client)
    })
    .then(_ => {
        return promisify(interrogateRecordsTxt)(client)
    })
    .then(form => {
        switch (cmd) {
            case 'add':
                return promisify(addRecordsTxt)(client, form)
            case 'del':
                return promisify(delRecordsTxt)(client, form)
            default:
                throw new Error(`Unknown command: ${cmd}`)
        }
    })
    .catch(error => {
        console.error(error)
        process.exit(-1)
    })
