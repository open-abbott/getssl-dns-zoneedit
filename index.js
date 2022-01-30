#!/usr/bin/env node
'use strict'

import extend from 'extend'
import https from 'https'
import md5 from 'md5'
import { parse as parseHtml } from 'node-html-parser'
import { Cookie, CookieJar, MemoryCookieStore } from 'tough-cookie'

const state = {
    domain: '', // defined later
    user: process.env.ZONEEDIT_USER,
    pass: process.env.ZONEEDIT_PASS,
    txtHost: '_acme-challenge',
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

class HttpClient {
    constructor() {
        const store = new MemoryCookieStore()
        this.cookieJar = new CookieJar(store, {
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
    const payload = Object.keys(form).map(k => {
        return `${encodeURIComponent(k)}=${encodeURIComponent(form[k])}`
    }).join('&')
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

function login(client, callback) {
    getLoginForm(client, (err, form) => {
        if (err) {
            callback(err)
        }
        form.login_user = state.user
        form.login_pass = state.pass
        form.login_hash = md5([
            form.login_user,
            md5(form.login_pass),
            form.login_chal
        ].join(""))
        performLogin(client, form, callback)
    })
}

function loginToDomain(client, callback) {
    const r = client.request({
        method: HttpMethod.GET,
        host: 'cp.zoneedit.com',
        path: `/manage/domains/?LOGIN=${state.domain}`
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

function recordsFromForm(form) {
    const records = []
    Object.keys(form)
        .filter(k => k.match('^TXT::'))
        .forEach(k => {
            const a = k.split('::')
            if (!(a[1] in records)) {
                records[a[1]] = {}
            }
            records[a[1]][a[2]] = form[k]
        })
    return records
}

function addTxtRecord(form) {
    const records = recordsFromForm(form)

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
        if ('object' === typeof r) {
            // this field seems unnecessary for create
            delete r.del
            Object.keys(r).forEach(k => {
                form[`TXT::${i}::${k}`] = r[k]
            })
        }
    })

    // ???
    form.next = ''

    return form
}

function delTxtRecord(form) {
    const records = recordsFromForm(form)

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
        if ('object' === typeof r) {
            if (state.txtHost === r.host) {
                r.del = 1
            }
            else {
                delete r.del
            }
            Object.keys(r).forEach(k => {
                form[`TXT::${i}::${k}`] = r[k]
            })
        }
    })

    // ???
    form.next = ''

    return form
}

function confirmRecordsTxt(client, form, callback) {
    const payload = Object.keys(form).map(k => {
        return `${encodeURIComponent(k)}=${encodeURIComponent(form[k])}`
    }).join('&')
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

    const payload = Object.keys(form).map(k => {
        return `${encodeURIComponent(k)}=${encodeURIComponent(form[k])}`
    }).join('&')
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
state.domain = domain
state.txtValue = txtValue

const client = new HttpClient()
login(client, (err, client) => {
    if (err) {
        throw err
    }
    loginToDomain(client, (err, client) => {
        if (err) {
            throw err
        }
        interrogateRecordsTxt(client, (err, form) => {
            if (err) {
                throw err
            }
            if ('add' === cmd) {
                addRecordsTxt(client, form, (err) => {
                    if (err) {
                        throw err
                    }
                })
            }
            else if ('del' === cmd) {
                delRecordsTxt(client, form, (err) => {
                    if (err) {
                        throw err
                    }
                })
            }
        })
    })
    
})
