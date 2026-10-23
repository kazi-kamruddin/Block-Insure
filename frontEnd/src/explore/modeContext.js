import { createContext, useContext } from "react";
export const ModeContext = createContext("live");
export const useAppMode = () => useContext(ModeContext);
