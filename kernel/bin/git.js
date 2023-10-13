const fs = require('fs')
const _7z = require('7zip-min-win-asar-support');
const fetch = require('cross-fetch')
const { rimraf } = require('rimraf')
const path = require("path")
class Git {
  async install(req, ondata) {
    await this.kernel.bin.exec({ message: "conda install -y -c conda-forge git" }, ondata)
    if (this.kernel.platform === 'win32') {
      let gitconfig_path = path.resolve(this.kernel.homedir, "gitconfig")
      // check if gitconfig exists
      let exists = await this.kernel.api.exists(gitconfig_path)
      // if not, create one
      if (!exists) {
        await fs.promises.copyFile(
          path.resolve(__dirname, "..", "gitconfig_template"),
          gitconfig_path
        )
      }
    }
  }
  async installed() {
    if (this.kernel.platform === 'win32') {
      let e = await this.kernel.bin.mod.conda.exists("git.exe")
      return e
    } else {
      let e = await this.kernel.bin.mod.conda.exists("git")
      return e
    }
  }
  async uninstall(req, ondata) {
    await this.kernel.bin.exec({ message: "conda remove git" }, ondata)
  }
  env() {
    if (this.kernel.platform === 'win32') {
      let gitconfig_path = path.resolve(this.kernel.homedir, "gitconfig")
      return {
        GIT_CONFIG_GLOBAL: gitconfig_path
      }
    }
  }
  async requires() {
    return ["conda"]
  }
}
module.exports = Git
