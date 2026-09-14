import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
const server = await createServer({configFile:false,root:'.lab-rya433',plugins:[react()],server:{host:'127.0.0.1',port:Number(process.env.PORT),strictPort:true,fs:{allow:[process.cwd()]}}})
await server.listen()
