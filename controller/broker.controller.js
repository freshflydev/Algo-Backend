import { brokerAuth, onLocalTest, resetAuth, brokerAccess, getAccessToken, getToken, getCache } from "../service/broker.service.js"

export const authAPI = async (req, res) => {  
    const url = await brokerAuth();
    res.send("<a href="+url+">"+url+"<a/>");
}

export const init = async (req, res) => {  
    let access_code = getAccessToken();
	if(!access_code){
    try {
      const auth_code = req.query.auth_code;
      let data = await brokerAccess(auth_code);
      if(data)
       return res.status(200).json({"success" : "FoodCrisis (FreshFly Inc.) is under ideation phase, will soon be coming to deliver Fresh, Organic & Healthy Food in India",data:data.code});
      else
        return res.status(200).json({data:data,status:"not authenticated"});
    }catch (err){
      res.status(500).json(err);
    }
    }else{
        let auth_code = getCache('auth_code');
        res.status(200).json({ "success" : "FoodCrisis (FreshFly Inc.) is under ideation phase, will soon be coming to deliver Fresh, Organic & Healthy Food in India" });
    }
}

export const localTest = async (req, res) => {  
    onLocalTest();
    res.status(200).json({status:"ok",code:getCache('auth_code')});
}

export const resetAPI = async (req, res) => {  
    resetAuth();
    res.status(200).json({status:true});
}

export const tokenAPI = async (req, res) => {  
    res.json(getToken());
}
