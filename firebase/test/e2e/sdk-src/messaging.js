export const getMessaging = () => ({});
export const getToken = async () => 'fake-token-' + Math.random().toString(36).slice(2,8);
export const onMessage = () => () => {};
export const isSupported = async () => true;
export const deleteToken = async () => true;
