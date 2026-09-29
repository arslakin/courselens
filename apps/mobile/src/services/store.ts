import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KeyValueStore } from "@rojanda/core";

/**
 * KeyValueStore backed by React Native AsyncStorage — keeps all private
 * student data on-device in this phase. Swappable for a cloud-backed store
 * later without touching services or screens.
 */
export const asyncStore: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};
