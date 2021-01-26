import { Client, ClientOptions, Message, Util } from 'discord.js'
import path from 'path'
import { CommandClientOptions, CommandType, ListenerType } from '../types'
import CommandClientError from './CommandClientError'
import Extension from './Extension'
import chokidar from 'chokidar'

export default class CommandClient extends Client {
  commandClientOptions: CommandClientOptions
  extensions: Extension[] = []
  watchers: { watcher: chokidar.FSWatcher; path: string }[] = []

  constructor(options: CommandClientOptions, clientOptions?: ClientOptions) {
    super(clientOptions)
    Util.mergeDefault(
      {
        commandHandler: {},
        watch: false,
      },
      options,
    )
    this.commandClientOptions = options
    this.on('message', this._handleCommand)
  }

  private async _handleCommand(msg: Message) {
    if (msg.author.bot) return
    if (msg.author.id === this.user!.id) return
    const prefix = this.commandClientOptions.commandHandler.prefix
    if (!msg.content.startsWith(prefix)) return
    const args = msg.content.slice(prefix.length).split(' ')
    const command = args.shift()
    if (!command) return
    const mod = this.extensions.find((r) =>
      r.commands.find((r) => r.name === command || r.aliases.includes(command)),
    )
    if (!mod) return
    const cmd = mod.commands.find(
      (r) => r.name === command || r.aliases.includes(command),
    )
    if (!cmd) return
    if (!(await mod.permit())) return
    cmd.fn.bind(mod)(msg, args)
  }

  emit(event: string, ...args: any[]) {
    const mods = this.extensions
      .filter((r) => r.listeners.find((r) => r.event === event))
      .map((r) => r.listeners.filter((r) => r.event === event))
    const listeners: ListenerType[] = []
    for (const mod of mods) {
      for (const listener of mod) {
        listeners.push(listener)
      }
    }
    listeners.forEach((r) => r.fn(event, ...args))
    return super.emit(event, ...args)
  }

  loadExtensions(path1: string) {
    let path2: string
    try {
      path2 = path.resolve(
        path.join(this.commandClientOptions.currentDir, path1),
      )
    } catch {
      throw new CommandClientError(
        'Unknown module ' +
          path.join(this.commandClientOptions.currentDir, path1),
      )
    }
    let mod
    try {
      mod = require(path2)
    } catch (e) {
      throw e
    }
    const extensions = Object.values(mod).filter(
      (r: any) => r.prototype instanceof Extension,
    ) as any[]
    if (!extensions.length)
      throw new CommandClientError('No extensions found in module')
    extensions.forEach((i) => {
      const ext = new i(this) as any
      const keys = Object.getOwnPropertyNames(i.prototype).filter(
        (r) =>
          ![...Extension.builtinFunctions, 'constructor', 'name'].includes(r),
      )
      ext.__path = path2
      ext.commands = keys
        .filter((r) => Reflect.get(ext[r], 'discord:type') === 'command')
        .map((r) => {
          const fn = ext[r]
          const name = Reflect.get(fn, 'command:name')
          const aliases = Reflect.get(fn, 'command:aliases')
          return { fn, name, aliases }
        }) as CommandType[]
      ext.listeners = keys
        .filter((r) => Reflect.get(ext[r], 'discord:type') === 'listener')
        .map((r) => {
          const fn = ext[r]
          const event = Reflect.get(fn, 'listener:event')
          return { fn, event }
        }) as ListenerType[]

      this.extensions.push(ext)
    })
  }

  unloadExtensions(path1: string, reload: boolean = false) {
    if (!reload) {
    }
    let path2: string | undefined
    try {
      path2 = path.resolve(
        path.join(this.commandClientOptions.currentDir, path1),
      )
    } catch {
      throw new CommandClientError(
        'Unknown path ' +
          path.join(this.commandClientOptions.currentDir, path1),
      )
    }
    const mod = this.extensions.find((r) => r.__path === path2)
    if (!mod) throw new CommandClientError('Module not registered.')
    delete require.cache[require.resolve(path2)]
    this.extensions = this.extensions.filter((r) => r !== mod)
  }
}
