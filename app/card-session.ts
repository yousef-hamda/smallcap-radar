import type {Snapshot} from '@/lib/engine';

type CardQuote={price?:number;dailyChange?:number;provenance?:Snapshot['provenance']};

/** A later verified close may arrive without a daily-change calculation. Keep
 * its price, but never attach a change from a different completed session. */
export function cardSession(snapshot:Snapshot,quote?:CardQuote){
 const savedPriceSource=snapshot.provenance.price;
 const quotePriceSource=quote?.provenance?.price;
 const quoteIsLater=!!quotePriceSource?.periodEnd
  && quotePriceSource.tag?.includes('last completed session close')
  && Number.isFinite(quote?.price)
  && quote!.price!>0
  && (!savedPriceSource?.periodEnd||quotePriceSource.periodEnd>=savedPriceSource.periodEnd);
 const price=quoteIsLater?quote!.price:snapshot.price;
 const priceSource=quoteIsLater?quotePriceSource:savedPriceSource;
 const priceDate=priceSource?.periodEnd;
 const completedClose=!!priceDate&&!!priceSource?.tag?.includes('last completed session close');
 const quoteChangeSource=quote?.provenance?.dailyChange;
 const quoteChangeMatches=quoteIsLater&&completedClose
  && quoteChangeSource?.periodEnd===priceDate
  && quoteChangeSource.tag?.includes('previous completed close')
  && Number.isFinite(quote?.dailyChange);
 const savedChangeSource=snapshot.provenance.dailyChange;
 const savedChangeMatches=completedClose
  && (!quoteIsLater||quote?.price===snapshot.price)
  && savedChangeSource?.periodEnd===priceDate
  && savedChangeSource.tag?.includes('previous completed close')
  && Number.isFinite(snapshot.dailyChange);
 const dailyChange=quoteChangeMatches?quote!.dailyChange:savedChangeMatches?snapshot.dailyChange:null;
 const changeDate=dailyChange==null?null:priceDate;
 return {price,priceDate,completedClose,dailyChange,changeDate,hasPrice:Number.isFinite(price)};
}
