import * as SecureStore from 'expo-secure-store'

export async function setToken(key: string, value: string) {
  await SecureStore.setItemAsync(key, value)
}

export async function getToken(key: string) {
  return await SecureStore.getItemAsync(key)
}

export async function removeToken(key: string) {
  await SecureStore.deleteItemAsync(key)
}