'use strict';

/**
 *  message controller
 */

const {
  createCoreController
} = require('@strapi/strapi').factories;

module.exports = createCoreController('api::message.message', ({strapi}) => ({
  async create(ctx) {
    // some logic here

    // Check Message Language and credits required
    const MESSAGE = ctx.request.body.data; // we didn't check if it exists or not
    const MSEGAT_USERNAME = process.env.MSEGAT_USERNAME;
    const MSEGAT_API_KEY = process.env.MSEGAT_API_KEY;
    const MSEGAT_SENDER = ctx.state.user.sender_name;
    const MSEGAT_BALANCE_URL = 'https://www.msegat.com/gw/Credits.php';
    const MSEGAT_SEND_URL = 'https://www.msegat.com/gw/sendsms.php';
    const MSEGAT_ENCODING = "UTF8";

    let required_credit = 1;

    const english = /^[~`!@ #$%^&*()_+=[\]\\{}|;':",.\/<>?a-zA-Z0-9-]+$/;
    const isEnglish = english.test(MESSAGE.content);

    if (isEnglish) {
      required_credit = (MESSAGE.content.length > 160) ? Math.ceil(MESSAGE.content.length / 153) : 1;
    } else {
      required_credit = (MESSAGE.content.length > 70) ? Math.ceil(MESSAGE.content.length / 63) : 1;
    }

    // check if has credit
    if (ctx.state.user.credit < required_credit) {
      return ctx.badRequest('You have no credits', {
        'user credits': ctx.state.user.credit,
        'message required credits': required_credit
      })
    }

    // check API balance
    const axios = require('axios');
    const qs = require('qs');

    const params = qs.stringify({
      'userName': MSEGAT_USERNAME,
      'apiKey': MSEGAT_API_KEY,
      'msgEncoding': MSEGAT_ENCODING,
    })

    let {data} = await axios.post(MSEGAT_BALANCE_URL, params, {headers: {"Content-Type": "application/x-www-form-urlencoded",},});

    const MSEGAT_BALANCE = data;

    if (MSEGAT_BALANCE < required_credit) {
      return ctx.badRequest('SMS Provider Has No Credit', {
        'user credits': ctx.state.user.credit,
        'provider credits': MSEGAT_BALANCE,
        'message required credits': required_credit
      })
    }

    // Add to DB as pending
    ctx.request.body.data.status = 'pending';
    let response = await super.create(ctx);
    
    // Send through provider
    try {
      //send the sms to gateway
      if (MSEGAT_API_KEY) {

        const params = {
          userName: MSEGAT_USERNAME,
          numbers: MESSAGE.to,
          userSender: MSEGAT_SENDER,
          apiKey: MSEGAT_API_KEY,
          msg: MESSAGE.content
        };
        let {data} = await axios.post(MSEGAT_SEND_URL, params);

        if(data.code != '1'){
          return ctx.badRequest('Provider Did Not Accept the Message',data)
        }
        
        

        // if reached here then it is a success, update status, if not, put keep pending and add comment, and reduce the credit by 1
        ctx.request.body.data.status = 'sent';
        //ctx.request.body.data.id = response.data.id;

        response = await strapi.entityService.update('api::message.message', response.data.id, {data: ctx.request.body.data,});
        const new_user_credits = ctx.state.user.credit - required_credit;

        //reduce user credit
        const updateCredit = await strapi.entityService.update('plugin::users-permissions.user', ctx.state.user.id, {data: {credit: new_user_credits}});
    
        response.meta = {};
        response.meta.gateway_response = data

        response.meta.additional_data = {
          'old user credits': ctx.state.user.credit,
          'new user credits': new_user_credits,
          'provider credits': MSEGAT_BALANCE,
          'message required credits': required_credit,
          'isEnglish': isEnglish,
          'MESSAGE.length': MESSAGE.content.length
        }
      } else {
        return ctx.badRequest('API Key not provided')
      }
    } catch (error) {
      console.error(error);
      return ctx.badRequest('An Error occured', error)
    }

    return response;
  }
}));
