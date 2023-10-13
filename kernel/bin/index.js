const os = require('os')
const fs = require('fs')
const _ = require('lodash')
const path = require('path')
const { rimraf } = require('rimraf')
const { DownloaderHelper } = require('node-downloader-helper');

const Cmake = require("./cmake")
const Python = require('./python')
const Git = require('./git')
const Node = require('./node')
const Brew = require("./brew")
const Conda = require("./conda")
const Win = require("./win")
const Ffmpeg = require("./ffmpeg")
const Aria2 = require('./aria2')
const Zip = require('./zip')
const LLVM = require('./llvm')
const VS = require("./vs")
const Cuda = require("./cuda")
const Torch = require("./torch")
//const Puppet = require("./puppeteer")
class Bin {
  constructor(kernel) {
    this.kernel = kernel
    this.arch = os.arch()
    this.platform = os.platform()
  }
  async exec(params, ondata) {
    params.path = this.path()
    if (this.client) {
      params.cols = this.client.cols
      params.rows = this.client.rows
    }
    let response = await this.kernel.shell.run(params, null, ondata)
    return response
  }
  async download(url, dest, ondata) {
    const dl = new DownloaderHelper(url, this.path(), {
      fileName: dest
    })
    ondata({ raw: `\r\nDownloading ${url} to ${this.path()}...\r\n` })
    let res = await new Promise((resolve, reject) => {
      dl.on('end', () => {
        ondata({ raw: `\r\nDownload Complete!\r\n` })
        resolve()
      })
      dl.on('error', (err) => {
        ondata({ raw: `\r\nDownload Failed: ${err.message}!\r\n` })
        reject(err)
      })
      dl.on('progress', (stats) => {
        let p = Math.floor(stats.progress)
        let str = ""
        for(let i=0; i<p; i++) {
          str += "#"
        }
        for(let i=p; i<100; i++) {
          str += "-"
        }
        ondata({ raw: `\r${str}` })
      })
      dl.start().catch((err) => {
        ondata({ raw: `\r\nDownload Failed: ${err.message}!\r\n` })
        reject(err)
      })
    })

  /*
    await this.exec({ message: `aria2 -o download.zip ${url}` })
    */
  }
  async unzip(filepath, dest, options, ondata) {
    await this.exec({ message: `7z x ${options ? options : ''} ${filepath} -o${dest}` }, ondata)
  }
  async rm(src, ondata) {
    ondata({ raw: `rm ${src}\r\n` })
    await fs.promises.rm(this.path(src), { recursive: true })
    //await rimraf(src)
    ondata({ raw: `success\r\n` })
  }
  async mv(src, dest, ondata) {
    ondata({ raw: `mv ${src} ${dest}\r\n` })
    await fs.promises.rename(this.path(src), this.path(dest))
    ondata({ raw: `success\r\n` })
  }
  exists(_path) {
    let abspath = this.path(_path)
    return new Promise(r=>fs.access(abspath, fs.constants.F_OK, e => r(!e)))
  }

  /*
    env(kernel)
    init(kernel)
    installed(kernel)
    install(req, ondata, kernel)
    uninstall(req, ondata, kernel)
  */
  merge_env(existing, merge) {
    // merge 'merge' into 'existing'
    for(let key in merge) {
      let val = merge[key]
      if (Array.isArray(val)) {
        if (typeof existing[key] === 'undefined') {
          existing[key] = val
        } else {
          existing[key] = existing[key].concat(val)
        }
      } else {
        existing[key] = val
      }
    }
    return existing
  }
  envs(override_env) {
    // return a single merged env object, constructed from all the modules

    // 1. get the module envs
    let envs = this.mods.map((mod) => {
      if (mod.mod.env) {
        return mod.mod.env(this.kernel)
      } else {
        return null
      }
    }).filter(x => x)

    // 2. Merge module envs
    let e = {}
    for(let env of envs) {
      e = this.merge_env(e, env)
    }

    // 3. Merge override_envs
    e = this.merge_env(e, override_env)

    return e
  }
  async init() {
    const bin_folder = this.path()
    await fs.promises.mkdir(bin_folder, { recursive: true }).catch((e) => { })
    // ORDERING MATTERS.
    // General purpose package managers like conda, conda needs to come at the end

    let modfiles = (await fs.promises.readdir(__dirname)).filter((file) => {
      return file.endsWith(".js") && file !== "index.js"
    })


    this.mods = []
    for(let filename of modfiles) {
      // 1. get all the modules in __dirname
      // 2. load them
      // 3. create this.mods
      let filepath = path.resolve(__dirname, filename)
      let mod = (await this.kernel.loader.load(filepath)).resolved
      let name = path.basename(filename, ".js")
      this.mods.push({ name, mod })
    }
    // inject kernel
    for(let i=0; i<this.mods.length; i++) {
      this.mods[i].mod.kernel = this.kernel 
    }

    // init mods
    this.mod = {}
    this.installed = {}
    for(let mod of this.mods) {
      if (mod.mod.init) {
        await mod.mod.init()
      }
      this.mod[mod.name] = mod.mod
    }

    this.refreshInstalled()

    /*
      this.installed.conda = Set()
      this.installed.pip = Set()
      this.installed.brew = Set()
    */
  }
  async refreshInstalled() {
    this.installed_initialized = false

    this.installed = {}

    let res = await this.exec({ message: `conda list`, conda: "base" }, (stream) => {
    })
    let lines = res.response.split(/[\r\n]+/)
    let conda = new Set()
    let start
    for(let line of lines) {
      if (start) {
        let chunks = line.split(/\s+/).filter(x => x)
        if (chunks.length > 1) {
          conda.add(chunks[0])
        }
      } else {
        if (/name.*version.*build.*channel/i.test(line)) {
          start = true 
        }
      }
    }
    this.installed.conda = conda

    start = false
    res = await this.exec({ message: `pip list` }, (stream) => {
    })
    lines = res.response.split(/[\r\n]+/)
    let pip = new Set()
    for(let line of lines) {
      if (start) {
        let chunks = line.split(/\s+/).filter(x => x)
        if (chunks.length > 1) {
          pip.add(chunks[0])
        }
      } else {
        if (/-------.*/i.test(line)) {
          start = true 
        }
      }
    }
    this.installed.pip = pip

    
    if (this.platform === "darwin") {
      start = false
      res = await this.exec({ message: `brew list -1` }, (stream) => {
      })
      lines = res.response.split(/[\r\n]+/).slice(0, -1)  // ignore last line since it's the prompt
      let brew = []
      let end = false
      for(let line of lines) {
        if (start) {
          if (/^\s*$/.test(line)) {
            end = true
          } else {
            if (!end) {
              let chunks = line.split(/\s+/).filter(x => x)
              brew = brew.concat(chunks)
            }
          }
        } else {
          if (/==>/.test(line)) {
            start = true
          }
        }
      }
      this.installed.brew = new Set(brew)
    }
    this.installed_initialized = true

  }
  path(...args) {
    return this.kernel.path("bin", ...args)
  }
  mod(name) {
    let filtered = this.mods.filter((m) => {
      return m.name === name
    })
    return (filtered.length > 0 ? filtered[0].mod : null)
  }
  //async install(name, options, ondata) {
  //  await this.mod(name).rm({}, ondata)
  //  await this.mod(name).install(options, ondata)
  //}
  async install(req, ondata) {
    /*
      req.params := {
        client: {
        },
        requirements: [{
          type: "bin"|"api",
          uri: <name>
        }, {
          ...
        }]
      }
    */
    if (req.client) {
      this.client = req.client
    } else {
      this.client = null
    }

    let requirements = JSON.parse(req.params)
    let current_platform = os.platform()
    for(let requirement of requirements) {
      let type = requirement.type
      let platform = requirement.platform
      let name = requirement.name
      let args = requirement.args || ""
      if (requirement.installed) {
        console.log("Already installed", requirement)
      } else {
        console.log("Not yet installed", requirement)
        /*
          {
            platform: win32|darwin|linux|<none>,
            type: conda|pip|brew|npm,
            name: <package name>,
            args: <install flags>
          }
        */
        if (!platform || platform === current_platform) {
          if (type === "conda") {
            await this.exec({
              message: `conda install ${name} -y ${args}`,
              conda: "base"
            }, ondata)
          } else if (type === "pip") {
            await this.exec({
              message: `pip install ${name} ${args}`
            }, ondata)
          } else if (type === "brew") {
            await this.exec({
              message: `brew install ${name} ${args}`
            }, ondata)
          } else {
            // find the mod
            for(let m of this.mods) {
              if (m.name === name) {
                //await m.mod.install(this, ondata)
                console.log("########### Installing", requirement)
                await m.mod.install(requirement, ondata, this.kernel)
                break
              }
            }
          }
        }
      }
    }
    this.refreshInstalled()
  }
  async sh(params, ondata) {
    let response = await this.kernel.shell.run(params, null, ondata)
    return response
  }
}
module.exports = Bin
