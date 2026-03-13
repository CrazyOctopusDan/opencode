import { sm2 } from "sm-crypto"

const DEFAULT_PUBLIC_KEY =
  "04E3E9147DC0A86E3C6E56B1EB46D2913153A284A57EB6DEC94EBB8A073F22AF8B5EC918860B5DC2CA8CDD4F89A3533A7C16EB6A6531D84EC67E4408C901457FAA"

export namespace SM2 {
  export function encryptPassword(password: string, publicKey?: string) {
    const key = publicKey?.trim() || DEFAULT_PUBLIC_KEY
    return sm2.doEncrypt(password, key, 1)
  }
}
 
