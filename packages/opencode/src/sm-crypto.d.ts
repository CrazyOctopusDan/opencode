declare module "sm-crypto" {
  export const sm2: {
    doEncrypt(input: string, publicKey: string, cipherMode?: 0 | 1): string
  }
}
